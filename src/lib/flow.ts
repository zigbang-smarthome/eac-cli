/**
 * EAC 비용정산 상신 flow.
 *
 * 11 steps observed by reverse-engineering the UniDocu UI:
 *   1.  ZUNIEFI_4003       계산 (ZFBDT 등 기본값)
 *   2.  ZUNIECM_5030       EA 전표용 EVI_SEQ 채번  (IS_KEY_PROGRAM_ID = 비용 메뉴 id)
 *   3.  fineuploader/*     EA 전표에 영수증 업로드  (optional — EA layer only; 결재자는 이걸로 보지 않음)
 *   4.  ZUNIEFI_4006       비용항목 저장
 *   5.  ZUNIEFI_5000       SAP posting → BELNR 채번
 *   6.  ZUNIEFI_4203       GRONO 예약 (아직 상신 아님)
 *   7.  ZUNIECM_5030       결재문서용 EVI_SEQ 채번  (IS_KEY_PROGRAM_ID = "DRAFT_0010")  ← 핵심
 *   8.  fineuploader/*     결재문서 EVI_SEQ에 영수증 업로드                             ← 핵심
 *   9.  ZUNIEWF_2200       개인결재선 목록 조회
 *   10. ZUNIEWF_4101       결재라인 상세(결재자 리스트) 조회
 *   11. ApprovalStep       최종 상신 (body에 `EVI_SEQ = 결재문서용 EVI_SEQ` 포함 필수)
 *
 * WF_ATTACH_FLAG=X가 붙으려면 Steps 7-8 + 11의 EVI_SEQ 필드 모두 필요하다. Steps 1-6만으로는
 * EA 전표는 생성되지만 결재 리스트의 첨부 아이콘은 뜨지 않는다 (결재자가 증빙 못 봄).
 */

import { callNS, uploadFile, listSession, type ClientContext } from "./client.ts";
import type { ApprovalLine, UserProfile, ReimbursementItem } from "../types/index.ts";
import { ApiError } from "./errors.ts";

const PROG_EA_MENU = "UD_0302_000";       // 비용정산 > 개인비용
const PROG_DRAFT   = "DRAFT_0010";         // 결재요청 폼
const PROG_LEGACY  = "ZB_0202_001";        // 과거 장려지원금 전용 메뉴 id — 4003/4006/5000이 이걸 기대

/** Default inline body used by the 결재요청 form. Copied verbatim from observed UI payload. */
const DEFAULT_I_BODY = `<strong>*원품의 또는 별도 정책에 근거한 비용집행내용을 아래 양식에 따라 작성하되, 필요시 추가내용 작성 가능</strong><br><p style="color:red;">(본 안내사항은 삭제 후 내용 작성)</p><br><br><strong>1. 지급조건</strong><br>   (ex) 계약체결 후 30일 이내 계약금 00원 지급, 1차 납품일로부터 30일 이내 중도금 00원 지급, 매월 00일/매분기 말일 지급<br><br><strong>2. 지급조건 달성여부</strong><br>   (ex) 계약체결일, 납품일, 수령일 등 기재<br><br><strong>3. 지급기한</strong><br>   - 계약서 또는 정책상 가장 늦은 지급기일 (만약 조기 집행하는 경우 그 사유를 명시)<br><br><strong>4. 기타</strong><br>   - 기타 지급품의에 기술되어야 하는 내용 기재`;

export interface SubmitParams {
  user: UserProfile;
  item: ReimbursementItem;
  title: string;           // e.g. "2026년 4월 자기관리비"
  budat: string;           // Posting date YYYYMMDD (today)
  bldat: string;           // Receipt date YYYYMMDD
  amountWon: number;       // Amount to post (e.g. 30800)
  attachFiles: string[];   // Absolute paths to attach
  iBody?: string;          // Optional body text; defaults to template
  doSubmit: boolean;       // If false, stops after BELNR (임시전표 저장). If true, continues to 상신.
}

export interface SubmitResult {
  eviSeqEa: string;
  belnr: string;
  grono?: string;
  eviSeqDraft?: string;
  submitted: boolean;
}

export async function submitExpense(ctx: ClientContext, p: SubmitParams): Promise<SubmitResult> {
  // Step 1: 기본값 계산 (ZFBDT 등)
  const r4003 = await callNS(ctx, "ZUNIEFI_4003", PROG_LEGACY, {
    BUDAT: p.budat, BLDAT: p.bldat, BLART: "KE",
    LIFNR: p.user.pernr, LIFNR_TXT: p.user.pernrName,
    BUPLA: "K100", GSBER: "K200", MWSKZ: "T0",
    AKONT: "21020103", ZTERM: "V123",
    WRBTR: String(p.amountWon), WRBTR_SLASH: "", WMWST: "0",
    BVTYP: "0001", ZFBDT: "", ZFBDT_SLASH: "",
    ZLSCH: "R", EMPTY: "",
    SGTXT: p.title, BUKRS: p.user.bukrs,
    tableParamsString: "{}",
  });
  const zfbdtStr: string = (r4003?.NSReturn?.exportMaps as any)?.OS_DATA?.ZFBDT ?? "";
  const zfbdt = zfbdtStr.replace(/-/g, "") || computeZfbdt(p.bldat);

  // Step 2: EA 전표용 EVI_SEQ
  const r5030ea = await callNS(ctx, "ZUNIECM_5030", PROG_LEGACY, { tableParamsString: "{}" });
  const eviSeqEa: string = r5030ea?.NSReturn?.stringReturns?.O_EVI_SEQ ?? "";
  if (!eviSeqEa) throw new ApiError("ZUNIECM_5030", 200, "O_EVI_SEQ not returned (EA layer)", JSON.stringify(r5030ea));

  // Step 3: fineuploader — EA 전표 첨부 (optional but harmless; mirrors original UI)
  for (const path of p.attachFiles) {
    await uploadFile(ctx, eviSeqEa, path);
  }

  // Step 4: 비용항목 저장
  const commonFi = {
    BUDAT: p.budat, BLDAT: p.bldat, BLART: "KE",
    LIFNR: p.user.pernr, LIFNR_TXT: p.user.pernrName,
    BUPLA: "K100", GSBER: "K200", MWSKZ: "T0",
    AKONT: "21020103", ZTERM: "V123",
    WRBTR: String(p.amountWon), WRBTR_SLASH: "", WMWST: "0",
    BVTYP: "0001", ZFBDT: zfbdt, ZFBDT_SLASH: "",
    ZLSCH: "R", EMPTY: "",
    SGTXT: p.title, BUKRS: p.user.bukrs,
    difference_amount: "0",
    debitSum: String(p.amountWon),
    creditSum: String(p.amountWon),
    GL_ALIAS: "", EMPTY1: "", EMPTY2: "", FAVOR: "",
    searchCondition: "HKONT", searchWord: "",
    EVI_SEQ: eviSeqEa,
    tableParamsString: JSON.stringify({
      IT_DATA: [{
        SELECTED: "1", SHKZG: "S",
        HKONT: p.item.hkont, HKONT_: "", HKONT_TXT: p.item.hkontText,
        WRBTR: String(p.amountWon),
        KOSTL: p.user.kostl, KOSTL_: "", KOSTL_TXT: p.user.kostlText,
        PROJK: "", PROJK_: "", PROJK_TXT: "",
        MWSKZ: "T0", SGTXT: p.title,
        ADD_DATA: "", ADD_DATA__HIDDEN: "", ADD_DATA_JSON: "",
      }],
      IT_ATTACH: [],
    }),
  };
  await callNS(ctx, "ZUNIEFI_4006", PROG_LEGACY, commonFi);

  // Step 5: SAP posting → BELNR
  const r5000 = await callNS(ctx, "ZUNIEFI_5000", PROG_LEGACY, commonFi);
  const belnr: string = (r5000?.NSReturn?.exportMaps as any)?.OS_DOCNO?.BELNR ?? "";
  if (!belnr) throw new ApiError("ZUNIEFI_5000", 200, "BELNR not returned", JSON.stringify(r5000));

  if (!p.doSubmit) return { eviSeqEa, belnr, submitted: false };

  // Step 6: GRONO 예약
  const submitRow = {
    SELECTED: "1", GRONO: "",
    BSTAT_TXT: "임시전표", STATS_TXT: "미상신",
    BLART: "KE", BLART_TXT: "e-Accounting Doc.",
    EVIKB: p.item.evikb, EVIKB_TXT: p.item.evikbText,
    BELNR: belnr, DOKNR: belnr,
    BUDAT: p.budat, BLDAT: p.bldat, ZFBDT: zfbdt,
    LIFNR: p.user.pernr, LIFNR_TXT: p.user.pernrName,
    WRBTR: String(p.amountWon), DMBTR: String(p.amountWon), WAERS: "KRW",
    SGTXT: p.title,
    PERNR: p.user.pernr, PERNR_TXT: p.user.wfIdText,
    "EVIKB_@": "", EVIKB_ADD: "",
    MWSKZ: "T0", STATS: "", GRONO_IMAGE: "",
    CHECK_FLG: "", AUTO_FLG: "",
    ZLSCH_TXT: "실시간이체", ZLSCH: "R",
    XBLNR: `${p.user.pernr}/${p.user.pernrName}`,
    STATUS: "", NAME1: "",
    KOSTL_TXT: p.user.kostlText, KOSTL: p.user.kostl,
    INV_SEQ: "",
    HKONT_TXT: p.item.hkontText, HKONT: p.item.hkont,
    GJAHR: deriveGjahr(p.budat),
    EVI_SEQ: eviSeqEa,
    CRD_SEQ: "", BUKRS: p.user.bukrs, BSTAT: "V",
    APPR_STAT_TXT: "", APPR_STATS_TXT: "", APPR_STATS: "", APPR_STAT: "",
    APPR_SEQ_STAT_TXT: "", APPR_SEQ_STAT_INT: "",
    APPR_SEQ_STATS_TXT: "", APPR_SEQ_STATS: "", APPR_SEQ_STAT: "",
  };
  const r4203 = await callNS(ctx, "ZUNIEFI_4203", PROG_EA_MENU, {
    tableParamsString: JSON.stringify({ IT_DATA: [submitRow] }),
  });
  const oUrl: string = r4203?.NSReturn?.stringReturns?.O_URL ?? "";
  const grono = oUrl.match(/GRONO=([^&]+)/)?.[1] ?? "";
  if (!grono) throw new ApiError("ZUNIEFI_4203", 200, "GRONO not parsed from O_URL", oUrl);

  // Step 7: 결재문서용 EVI_SEQ (서로 다른 시퀀스 풀) — WF_ATTACH_FLAG=X의 핵심 트리거
  const r5030draft = await callNS(ctx, "ZUNIECM_5030", PROG_DRAFT, { tableParamsString: "{}" });
  const eviSeqDraft: string = r5030draft?.NSReturn?.stringReturns?.O_EVI_SEQ ?? "";
  if (!eviSeqDraft) throw new ApiError("ZUNIECM_5030", 200, "O_EVI_SEQ not returned (DRAFT layer)", JSON.stringify(r5030draft));

  // Step 8: 결재문서 레이어에 파일 업로드
  for (const path of p.attachFiles) {
    await uploadFile(ctx, eviSeqDraft, path);
  }
  // Sanity check — should see all files
  const sess = await listSession(ctx, eviSeqDraft);
  if (sess.length !== p.attachFiles.length) {
    throw new Error(`draft attachment mismatch: expected ${p.attachFiles.length}, saw ${sess.length}`);
  }

  // Step 9: 개인결재선 목록 조회
  const r2200 = await callNS(ctx, "ZUNIEWF_2200", PROG_EA_MENU, { tableParamsString: "{}" });
  const lines: Array<Record<string, string>> = (r2200?.NSReturn?.tableReturns?.OT_DATA as any) ?? [];
  // Find the line matching item.wfLineSeq and item.wfLineLin1
  const wfLine = lines.find((l) => l.SEQ === p.item.wfLineSeq && l.WF_LIN1 === p.item.wfLineLin1)
    ?? lines.find((l) => l.SEQ === p.item.wfLineSeq)
    ?? lines.find((l) => (l.SEQ_TXT ?? "").includes(p.item.evikbText));
  if (!wfLine) {
    throw new Error(`개인결재선 not found: SEQ=${p.item.wfLineSeq}. Check "결재선 관리" menu and register "[개인]-${p.item.evikbText}".`);
  }

  // Step 10: 결재자 리스트 조회
  const r4101 = await callNS(ctx, "ZUNIEWF_4101", PROG_DRAFT, { ...wfLine, GRONO: grono, tableParamsString: "{}" });
  const approvers: Array<Record<string, string>> = (r4101?.NSReturn?.tableReturns?.OT_DATA1 as any) ?? [];
  if (!approvers.length) throw new ApiError("ZUNIEWF_4101", 200, "empty approver list", JSON.stringify(r4101).slice(0, 400));

  // Step 11: 최종 상신 (EVI_SEQ = 결재문서용 EVI_SEQ)
  const IT_DATA1: ApprovalLine[] = approvers.map((a) => ({
    ...a,
    SELECTED: "0",
    DISPLAY_TEXT: `${a.JOB_KEY_TXT ?? ""} ${a.WF_ID_TXT ?? ""}`.trim(),
    WF_LINE_LEV: parseInt(String(a.WF_LINE_LEV ?? "0"), 10),
    WF_SEQ: String(parseInt(String(a.WF_SEQ ?? "0"), 10)),
    WF_AGREE: "",
  }));

  const rFinal = await callNS(ctx, "ApprovalStep", PROG_DRAFT, {
    BUKRS: p.user.bukrs, WF_GB: "10", showAsPopup: "true",
    PERNR: p.user.pernr, WF_TYPE: "C", WF_AMOUNT: String(p.amountWon),
    ID: p.user.pernr, GRONO: grono, WF_TITLE: p.title,
    I_BODY: p.iBody ?? DEFAULT_I_BODY,
    EVI_SEQ: eviSeqDraft,      // ← WF_ATTACH_FLAG=X triggers because this is set
    WF_SECUR: "",
    targetNamedServiceId: "ZUNIEWF_4201",
    tableParamsString: JSON.stringify({ IT_DATA1 }),
  });
  const msg: string = rFinal?.NSReturn?.stringReturns?.message ?? "";
  if (!/상신/.test(msg)) throw new ApiError("ApprovalStep", 200, `unexpected message: ${msg}`, JSON.stringify(rFinal));

  return { eviSeqEa, belnr, grono, eviSeqDraft, submitted: true };
}

function computeZfbdt(bldat: string): string {
  // ZTERM=V123 = "After Doc.Date + 1 Month (23th)" → next month's 23rd
  const y = parseInt(bldat.slice(0, 4), 10);
  const m = parseInt(bldat.slice(4, 6), 10);
  const next = new Date(y, m, 23); // month is 0-based, so `m` is next month
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}`;
}

function deriveGjahr(budat: string): string {
  return budat.slice(0, 4);
}
