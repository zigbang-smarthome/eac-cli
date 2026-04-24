/**
 * High-level operations on EAC (UniDocu). Each function wraps one or more
 * named-service calls. CLI commands should be thin shims over these.
 */

import { callNS, uploadFile as uploadFileRaw, listSession, type ClientContext, type SessionFile } from "./client.ts";
import type { ApprovalLine, UserProfile, ReimbursementItem } from "../types/index.ts";
import { ApiError } from "./errors.ts";

/* ── Program IDs — mirror UniDocu menu codes ───────────────────────── */

/** 비용정산 > 개인비용 (EA 전표) */
export const PROG_EA_MENU = "UD_0302_000";
/** 결재요청 폼 (결재문서 첨부 레이어) */
export const PROG_DRAFT = "DRAFT_0010";
/** 결재문서 조회/회수 뷰어 */
export const PROG_VIEWER = "DRAFT_0011";
/** 장려지원금 전용 메뉴 (과거, 4003/4006/5000이 이것 기대) */
export const PROG_LEGACY = "ZB_0202_001";

/** 진행함/결재함 program IDs → DISPLAY_GB mapping */
export const APPROVAL_BOXES = {
  pending:  { prog: "UFL_0401_010", gb: "A", label: "미처리" },
  progress: { prog: "UFL_0401_020", gb: "D", label: "진행중" },
  rejected: { prog: "UFL_0401_030", gb: "C", label: "반려/회수" },
  approved: { prog: "UFL_0401_040", gb: "B", label: "승인" },
} as const;
export type ApprovalBox = keyof typeof APPROVAL_BOXES;

/* ── Attachments (fineuploader EVI_SEQ layer) ──────────────────────── */

/** Reserve a new EVI_SEQ via ZUNIECM_5030. The returned sequence is scoped to
 *  the program ID: the EA-전표 layer and the 결재문서 (DRAFT_0010) layer use
 *  independent pools. */
export async function createAttachSeq(ctx: ClientContext, programId: string): Promise<string> {
  const r = await callNS(ctx, "ZUNIECM_5030", programId, { tableParamsString: "{}" });
  const seq = r?.NSReturn?.stringReturns?.O_EVI_SEQ ?? "";
  if (!seq) throw new ApiError("ZUNIECM_5030", 200, "O_EVI_SEQ not returned", JSON.stringify(r));
  return seq;
}

export async function uploadAttachment(ctx: ClientContext, eviSeq: string, filePath: string): Promise<void> {
  await uploadFileRaw(ctx, eviSeq, filePath);
}

export async function uploadAttachments(ctx: ClientContext, eviSeq: string, filePaths: string[]): Promise<void> {
  for (const p of filePaths) await uploadFileRaw(ctx, eviSeq, p);
}

export async function listAttachments(ctx: ClientContext, eviSeq: string): Promise<SessionFile[]> {
  return await listSession(ctx, eviSeq);
}

/* ── EA 전표 (임시전표) — UD_0302_000 grid ─────────────────────────── */

export interface TempDocRow {
  GRONO: string;
  BELNR: string;
  DOKNR: string;
  EVI_SEQ: string;
  BUDAT: string;
  BLDAT: string;
  ZFBDT: string;
  WRBTR: string;
  DMBTR: string;
  WAERS: string;
  SGTXT: string;
  BSTAT: string;
  BSTAT_TXT: string;
  STATS: string;
  STATS_TXT: string;
  BLART: string;
  BLART_TXT: string;
  EVIKB: string;
  EVIKB_TXT: string;
  LIFNR: string;
  LIFNR_TXT: string;
  PERNR: string;
  PERNR_TXT: string;
  KOSTL: string;
  KOSTL_TXT: string;
  HKONT: string;
  HKONT_TXT: string;
  GJAHR: string;
  BUKRS: string;
  [k: string]: string;
}

export interface TempListFilter {
  from: string;          // YYYYMMDD (BUDAT_FR)
  to: string;            // YYYYMMDD (BUDAT_TO)
  bstat?: string;        // "V" | "*" — default "*"
  stats?: string;        // "" | "C" | "R" | "2" | "4" | "*" — default "*"
  evikb?: string;
  belnr?: string;
}

export async function listTempDocs(ctx: ClientContext, filter: TempListFilter, user: UserProfile): Promise<TempDocRow[]> {
  const r = await callNS(ctx, "ZUNIEFI_4200", PROG_EA_MENU, {
    BUDAT_FR: filter.from, BUDAT_TO: filter.to,
    EVIKB: filter.evikb ?? "",
    PERNR: user.pernr, PERNR_TXT: user.pernrName,
    BSTAT: filter.bstat ?? "*",
    STATS: filter.stats ?? "*",
    BELNR: filter.belnr ?? "",
    BUKRS: user.bukrs,
    tableParamsString: "{}",
  });
  return (r?.NSReturn?.tableReturns?.OT_DATA as TempDocRow[] | undefined) ?? [];
}

/** 그룹번호취소 — releases the GRONO from a 회수(recalled) temp doc so it can be
 *  re-submitted. Sends the whole row fields back to ZUNIEFI_4202 with STATS=C. */
export async function cancelTempDocGroup(ctx: ClientContext, row: TempDocRow): Promise<void> {
  const fields: Record<string, string> = {};
  for (const k of Object.keys(row)) {
    const v = (row as any)[k];
    if (v == null) continue;
    fields[k] = String(v);
  }
  fields.SELECTED = "1";
  fields.STATS = "C";
  fields.tableParamsString = "{}";
  await callNS(ctx, "ZUNIEFI_4202", PROG_EA_MENU, fields);
}

/* ── 결재문서 (ZUNIEWF_4500 grid) ──────────────────────────────────── */

export interface ApprovalDocRow {
  GRONO: string;
  WF_KEY: string;
  WF_KEY_TEXT: string;
  WF_TITLE: string;
  WF_DATE: string;
  WF_TIME: string;
  WF_AMOUNT: string;
  WF_STATUS: string;
  WF_STATUS_TXT: string;
  WF_ATTACH_FLAG: string;
  WF_TYPE: string;
  WF_GB: string;
  EVIKB: string;
  EVIKB_TXT: string;
  WF_DEPT: string;
  WF_DEPT_TXT: string;
  WF_ID: string;
  WF_ID_TXT: string;
  PERNR: string;
  KOSTL: string;
  BUKRS: string;
  GJAHR: string;
  WF_SECUR: string;
  [k: string]: string;
}

export interface DocListFilter {
  from: string;
  to: string;
  evikb?: string;
  title?: string;
}

export async function listApprovalDocs(
  ctx: ClientContext,
  box: ApprovalBox,
  filter: DocListFilter,
): Promise<ApprovalDocRow[]> {
  const b = APPROVAL_BOXES[box];
  const r = await callNS(ctx, "ZUNIEWF_4500", b.prog, {
    ST_DATE_FR: filter.from, ST_DATE_TO: filter.to,
    EVIKB: filter.evikb ?? "",
    WF_ID: "", WF_ID_TXT: "", WF_GB: "",
    WF_TITLE: filter.title ?? "",
    DISPLAY_GB: b.gb,
    tableParamsString: "{}",
  });
  return (r?.NSReturn?.tableReturns?.OT_DATA as ApprovalDocRow[] | undefined) ?? [];
}

/** Returns 4207 response including the `URL` which carries the attachment fileGroupId. */
export async function showApprovalDoc(ctx: ClientContext, grono: string): Promise<any> {
  const r = await callNS(ctx, "ZUNIEFI_4207", PROG_DRAFT, { GRONO: grono, tableParamsString: "{}" });
  return r?.NSReturn?.tableReturns?.OT_DATA1?.[0] ?? null;
}

/** Extract the attachment EVI_SEQ (fileGroupId) from a ZUNIEFI_4207 response URL. */
export function parseFileGroupIdFromUrl(url: string): string | null {
  return url.match(/fileGroupId=([^&]+)/)?.[1] ?? null;
}

/** Look up one approval doc row (used to drive recall, which needs the whole row). */
export async function findApprovalDoc(
  ctx: ClientContext,
  grono: string,
  box: ApprovalBox = "progress",
  range: { from: string; to: string } = defaultYearRange(),
): Promise<ApprovalDocRow | null> {
  const rows = await listApprovalDocs(ctx, box, range);
  return rows.find((r) => r.GRONO === grono) ?? null;
}

/** Recall an in-progress approval document.
 *  Implementation: ApprovalStep with targetNamedServiceId=ZUNIEWF_4320 and APPR_STAT=E. */
export async function recallApprovalDoc(
  ctx: ClientContext,
  row: ApprovalDocRow,
  comment = "",
): Promise<string> {
  const fields: Record<string, string> = {};
  for (const k of Object.keys(row)) {
    const v = (row as any)[k];
    if (v == null) continue;
    fields[k] = String(v);
  }
  fields.SELECTED = "0";
  fields.APPR_STAT = "E";
  fields.APPR_TEXT = "";
  fields.APPR_TXT = "";
  fields.comments = comment;
  fields.showAsPopup = "true";
  fields.targetNamedServiceId = "ZUNIEWF_4320";
  fields.tableParamsString = "{}";
  const r = await callNS(ctx, "ApprovalStep", PROG_VIEWER, fields);
  return r?.NSReturn?.stringReturns?.message ?? "";
}

/* ── 결재선 (ZUNIEWF_2200/4101) ─────────────────────────────────── */

export interface PersonalLine {
  SEQ: string;
  SEQ_TXT: string;
  WF_LIN1: string;
  WF_LIN2: string;
  WF_LIN3: string;
  WF_LIN4: string;
  WF_LIN5: string;
  WF_USE: string;
  [k: string]: string;
}

export async function listPersonalLines(ctx: ClientContext): Promise<PersonalLine[]> {
  const r = await callNS(ctx, "ZUNIEWF_2200", PROG_EA_MENU, { tableParamsString: "{}" });
  return (r?.NSReturn?.tableReturns?.OT_DATA as PersonalLine[] | undefined) ?? [];
}

export async function getApprovers(
  ctx: ClientContext,
  line: PersonalLine,
  grono: string,
): Promise<Array<Record<string, string>>> {
  const r = await callNS(ctx, "ZUNIEWF_4101", PROG_DRAFT, {
    ...line,
    GRONO: grono,
    tableParamsString: "{}",
  });
  return (r?.NSReturn?.tableReturns?.OT_DATA1 as any) ?? [];
}

/* ── 비용 상신 primitives ───────────────────────────────────────────── */

/** 기본값 계산 (ZFBDT 등). */
export async function computeDefaults(
  ctx: ClientContext,
  user: UserProfile,
  bldat: string,
  budat: string,
  amountWon: number,
  title: string,
): Promise<{ zfbdt: string }> {
  const r = await callNS(ctx, "ZUNIEFI_4003", PROG_LEGACY, {
    BUDAT: budat, BLDAT: bldat, BLART: "KE",
    LIFNR: user.pernr, LIFNR_TXT: user.pernrName,
    BUPLA: "K100", GSBER: "K200", MWSKZ: "T0",
    AKONT: "21020103", ZTERM: "V123",
    WRBTR: String(amountWon), WRBTR_SLASH: "", WMWST: "0",
    BVTYP: "0001", ZFBDT: "", ZFBDT_SLASH: "",
    ZLSCH: "R", EMPTY: "",
    SGTXT: title, BUKRS: user.bukrs,
    tableParamsString: "{}",
  });
  const zfbdtStr: string = (r?.NSReturn?.exportMaps as any)?.OS_DATA?.ZFBDT ?? "";
  return { zfbdt: zfbdtStr.replace(/-/g, "") || computeZfbdtFallback(bldat) };
}

function computeZfbdtFallback(bldat: string): string {
  // ZTERM=V123 = "After Doc.Date + 1 Month (23th)" → next month's 23rd
  const y = parseInt(bldat.slice(0, 4), 10);
  const m = parseInt(bldat.slice(4, 6), 10);
  const next = new Date(y, m, 23);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}`;
}

/** Steps 1-5: Create a temp document (ZUNIEFI_4003 → 5030 → upload → 4006 → 5000). */
export async function createTempDoc(
  ctx: ClientContext,
  params: {
    user: UserProfile;
    item: ReimbursementItem;
    title: string;
    budat: string;
    bldat: string;
    amountWon: number;
    attachFiles: string[];
  },
): Promise<{ eviSeqEa: string; belnr: string; zfbdt: string }> {
  const { user, item, title, budat, bldat, amountWon, attachFiles } = params;

  const { zfbdt } = await computeDefaults(ctx, user, bldat, budat, amountWon, title);
  const eviSeqEa = await createAttachSeq(ctx, PROG_LEGACY);
  await uploadAttachments(ctx, eviSeqEa, attachFiles);

  const commonFi = {
    BUDAT: budat, BLDAT: bldat, BLART: "KE",
    LIFNR: user.pernr, LIFNR_TXT: user.pernrName,
    BUPLA: "K100", GSBER: "K200", MWSKZ: "T0",
    AKONT: "21020103", ZTERM: "V123",
    WRBTR: String(amountWon), WRBTR_SLASH: "", WMWST: "0",
    BVTYP: "0001", ZFBDT: zfbdt, ZFBDT_SLASH: "",
    ZLSCH: "R", EMPTY: "",
    SGTXT: title, BUKRS: user.bukrs,
    difference_amount: "0",
    debitSum: String(amountWon),
    creditSum: String(amountWon),
    GL_ALIAS: "", EMPTY1: "", EMPTY2: "", FAVOR: "",
    searchCondition: "HKONT", searchWord: "",
    EVI_SEQ: eviSeqEa,
    tableParamsString: JSON.stringify({
      IT_DATA: [{
        SELECTED: "1", SHKZG: "S",
        HKONT: item.hkont, HKONT_: "", HKONT_TXT: item.hkontText,
        WRBTR: String(amountWon),
        KOSTL: user.kostl, KOSTL_: "", KOSTL_TXT: user.kostlText,
        PROJK: "", PROJK_: "", PROJK_TXT: "",
        MWSKZ: "T0", SGTXT: title,
        ADD_DATA: "", ADD_DATA__HIDDEN: "", ADD_DATA_JSON: "",
      }],
      IT_ATTACH: [],
    }),
  };
  await callNS(ctx, "ZUNIEFI_4006", PROG_LEGACY, commonFi);

  const r5000 = await callNS(ctx, "ZUNIEFI_5000", PROG_LEGACY, commonFi);
  const belnr: string = (r5000?.NSReturn?.exportMaps as any)?.OS_DOCNO?.BELNR ?? "";
  if (!belnr) throw new ApiError("ZUNIEFI_5000", 200, "BELNR not returned", JSON.stringify(r5000));

  return { eviSeqEa, belnr, zfbdt };
}

/** Step 6: GRONO 예약. */
export async function reserveGrono(
  ctx: ClientContext,
  params: {
    user: UserProfile;
    item: ReimbursementItem;
    title: string;
    budat: string;
    bldat: string;
    zfbdt: string;
    amountWon: number;
    belnr: string;
    eviSeqEa: string;
  },
): Promise<string> {
  const { user, item, title, budat, bldat, zfbdt, amountWon, belnr, eviSeqEa } = params;
  const submitRow = {
    SELECTED: "1", GRONO: "",
    BSTAT_TXT: "임시전표", STATS_TXT: "미상신",
    BLART: "KE", BLART_TXT: "e-Accounting Doc.",
    EVIKB: item.evikb, EVIKB_TXT: item.evikbText,
    BELNR: belnr, DOKNR: belnr,
    BUDAT: budat, BLDAT: bldat, ZFBDT: zfbdt,
    LIFNR: user.pernr, LIFNR_TXT: user.pernrName,
    WRBTR: String(amountWon), DMBTR: String(amountWon), WAERS: "KRW",
    SGTXT: title,
    PERNR: user.pernr, PERNR_TXT: user.wfIdText,
    "EVIKB_@": "", EVIKB_ADD: "",
    MWSKZ: "T0", STATS: "", GRONO_IMAGE: "",
    CHECK_FLG: "", AUTO_FLG: "",
    ZLSCH_TXT: "실시간이체", ZLSCH: "R",
    XBLNR: `${user.pernr}/${user.pernrName}`,
    STATUS: "", NAME1: "",
    KOSTL_TXT: user.kostlText, KOSTL: user.kostl,
    INV_SEQ: "",
    HKONT_TXT: item.hkontText, HKONT: item.hkont,
    GJAHR: budat.slice(0, 4),
    EVI_SEQ: eviSeqEa,
    CRD_SEQ: "", BUKRS: user.bukrs, BSTAT: "V",
    APPR_STAT_TXT: "", APPR_STATS_TXT: "", APPR_STATS: "", APPR_STAT: "",
    APPR_SEQ_STAT_TXT: "", APPR_SEQ_STAT_INT: "",
    APPR_SEQ_STATS_TXT: "", APPR_SEQ_STATS: "", APPR_SEQ_STAT: "",
  };
  const r = await callNS(ctx, "ZUNIEFI_4203", PROG_EA_MENU, {
    tableParamsString: JSON.stringify({ IT_DATA: [submitRow] }),
  });
  const oUrl: string = r?.NSReturn?.stringReturns?.O_URL ?? "";
  const grono = oUrl.match(/GRONO=([^&]+)/)?.[1] ?? "";
  if (!grono) throw new ApiError("ZUNIEFI_4203", 200, "GRONO not parsed from O_URL", oUrl);
  return grono;
}

/** Default inline body used by the 결재요청 form (copied verbatim from UI payload). */
export const DEFAULT_I_BODY = `<strong>*원품의 또는 별도 정책에 근거한 비용집행내용을 아래 양식에 따라 작성하되, 필요시 추가내용 작성 가능</strong><br><p style="color:red;">(본 안내사항은 삭제 후 내용 작성)</p><br><br><strong>1. 지급조건</strong><br>   (ex) 계약체결 후 30일 이내 계약금 00원 지급, 1차 납품일로부터 30일 이내 중도금 00원 지급, 매월 00일/매분기 말일 지급<br><br><strong>2. 지급조건 달성여부</strong><br>   (ex) 계약체결일, 납품일, 수령일 등 기재<br><br><strong>3. 지급기한</strong><br>   - 계약서 또는 정책상 가장 늦은 지급기일 (만약 조기 집행하는 경우 그 사유를 명시)<br><br><strong>4. 기타</strong><br>   - 기타 지급품의에 기술되어야 하는 내용 기재`;

/** Steps 7-11: register a 결재문서용 EVI_SEQ, upload attachments, pick the line,
 *  fire ApprovalStep. `EVI_SEQ=<결재문서용>` in the final body is what triggers
 *  `WF_ATTACH_FLAG=X` on the approval list. */
export async function submitApproval(
  ctx: ClientContext,
  params: {
    user: UserProfile;
    item: ReimbursementItem;
    title: string;
    amountWon: number;
    grono: string;
    attachFiles: string[];
    iBody?: string;
  },
): Promise<{ eviSeqDraft: string; message: string }> {
  const { user, item, title, amountWon, grono, attachFiles, iBody } = params;

  const eviSeqDraft = await createAttachSeq(ctx, PROG_DRAFT);
  await uploadAttachments(ctx, eviSeqDraft, attachFiles);
  const sess = await listAttachments(ctx, eviSeqDraft);
  if (sess.length !== attachFiles.length) {
    throw new Error(`draft attachment mismatch: expected ${attachFiles.length}, saw ${sess.length}`);
  }

  const lines = await listPersonalLines(ctx);
  const wfLine = lines.find((l) => l.SEQ === item.wfLineSeq && l.WF_LIN1 === item.wfLineLin1)
    ?? lines.find((l) => l.SEQ === item.wfLineSeq)
    ?? lines.find((l) => (l.SEQ_TXT ?? "").includes(item.evikbText));
  if (!wfLine) {
    throw new Error(`개인결재선 not found: SEQ=${item.wfLineSeq}. Register "[개인]-${item.evikbText}" in 결재선 관리.`);
  }

  const approvers = await getApprovers(ctx, wfLine, grono);
  if (!approvers.length) throw new ApiError("ZUNIEWF_4101", 200, "empty approver list", "");

  const IT_DATA1: ApprovalLine[] = approvers.map((a) => ({
    ...a,
    SELECTED: "0",
    DISPLAY_TEXT: `${a.JOB_KEY_TXT ?? ""} ${a.WF_ID_TXT ?? ""}`.trim(),
    WF_LINE_LEV: parseInt(String(a.WF_LINE_LEV ?? "0"), 10),
    WF_SEQ: String(parseInt(String(a.WF_SEQ ?? "0"), 10)),
    WF_AGREE: "",
  }));

  const r = await callNS(ctx, "ApprovalStep", PROG_DRAFT, {
    BUKRS: user.bukrs, WF_GB: "10", showAsPopup: "true",
    PERNR: user.pernr, WF_TYPE: "C", WF_AMOUNT: String(amountWon),
    ID: user.pernr, GRONO: grono, WF_TITLE: title,
    I_BODY: iBody ?? DEFAULT_I_BODY,
    EVI_SEQ: eviSeqDraft,
    WF_SECUR: "",
    targetNamedServiceId: "ZUNIEWF_4201",
    tableParamsString: JSON.stringify({ IT_DATA1 }),
  });
  const message: string = r?.NSReturn?.stringReturns?.message ?? "";
  if (!/상신/.test(message)) throw new ApiError("ApprovalStep", 200, `unexpected message: ${message}`, JSON.stringify(r));

  return { eviSeqDraft, message };
}

/** Full task: create temp doc → reserve GRONO → submit approval. */
export async function submitExpenseFull(
  ctx: ClientContext,
  params: {
    user: UserProfile;
    item: ReimbursementItem;
    title: string;
    budat: string;
    bldat: string;
    amountWon: number;
    attachFiles: string[];
    iBody?: string;
  },
): Promise<{ eviSeqEa: string; belnr: string; grono: string; eviSeqDraft: string; message: string }> {
  const { eviSeqEa, belnr, zfbdt } = await createTempDoc(ctx, params);
  const grono = await reserveGrono(ctx, { ...params, zfbdt, belnr, eviSeqEa });
  const { eviSeqDraft, message } = await submitApproval(ctx, { ...params, grono });
  return { eviSeqEa, belnr, grono, eviSeqDraft, message };
}

/* ── helpers ───────────────────────────────────────────────────────── */

/** Wide default date range (current year). */
export function defaultYearRange(): { from: string; to: string } {
  const y = new Date().getFullYear();
  return { from: `${y}0101`, to: `${y}1231` };
}

/** Today in YYYYMMDD. */
export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
