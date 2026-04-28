/**
 * 법인카드(공용) commands.
 *
 *   corpcard list [--from] [--to] [--merch]    ZUNIEFI_1000 — 미정산 카드 거래 조회
 *   corpcard create <CRD_SEQ> --hkont --remark   ZUNIEFI_4006 + ZUNIEFI_1009 → BELNR
 *
 * 결재요청은 자기관리비/일반경비와 동일한 backend flow (ZUNIEFI_4203 → ApprovalStep).
 * `voucher request-approval <BELNR> --item 법인카드-회식대 --title "..." --attach-dir <dir>`
 * 로 이어가면 된다. 단, 카드는 영수증을 카드사가 후단에 자동 첨부하므로 attach-dir은
 * 결재함의 📎 표시용 (스킵 가능 — UI 동작상 첨부 없이도 회계팀이 거래 내역으로 확인).
 */

import { defineCommand } from "citty";
import { loadCtx, requireUser, formatWon, isoDate, pad } from "../lib/cli.ts";
import {
  listCardTransactions,
  createCorpCardVoucher,
  type CardTransaction,
} from "../lib/ops.ts";

function lastNDays(n: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - n);
  return { from: isoDate(from), to: isoDate(to) };
}

/* ── list ───────────────────────────────────────────────────────── */

const listSub = defineCommand({
  meta: { name: "list", description: "법인카드 사용내역 조회 (ZUNIEFI_1000). 미정산 거래만." },
  args: {
    from: { type: "string", description: "DATE_FR YYYYMMDD (default: 30 days ago)" },
    to: { type: "string", description: "DATE_TO YYYYMMDD (default: today)" },
    merch: { type: "string", description: "Filter by merchant name (substring)" },
    json: { type: "boolean", description: "Print raw JSON" },
  },
  async run({ args }) {
    const { ctx, cfg } = await loadCtx();
    const def = lastNDays(30);
    const rows = await listCardTransactions(ctx, requireUser(cfg), {
      from: args.from ?? def.from,
      to: args.to ?? def.to,
      merchName: args.merch,
    });
    if (args.json) { console.log(JSON.stringify(rows, null, 2)); return; }
    console.log(`${rows.length} transactions`);
    for (const r of rows) {
      const date = r.APPR_DATE.slice(0, 4) + "-" + r.APPR_DATE.slice(4, 6) + "-" + r.APPR_DATE.slice(6, 8);
      console.log(
        `  CRD_SEQ=${r.CRD_SEQ}  ${date} ${r.APPR_TIME}  ` +
        `${formatWon(r.TOTAL).padStart(10)}  ${(r.MCC_NAME ?? "").padEnd(10)}  ${r.MERCH_NAME}`,
      );
    }
  },
});

/* ── create ─────────────────────────────────────────────────────── */

const createSub = defineCommand({
  meta: { name: "create", description: "카드 거래 → 임시전표 (ZUNIEFI_4006 + ZUNIEFI_1009 → BELNR). 첨부 없음 (카드사 영수증 자동)." },
  args: {
    crdseq: { type: "positional", required: true, description: "CRD_SEQ from `corpcard list`" },
    hkont: { type: "string", required: true, description: "G/L 계정 코드 (e.g. 52010102 회식대 / 52060101 회의비 / 52050104 접대비)" },
    "hkont-text": { type: "string", description: 'G/L 계정명 (e.g. "판)복리후생비-회식대"). Default: server resolves.' },
    remark: { type: "string", required: true, description: "적요 (SGTXT). Format: [법인카드/거래처/참석자]" },
    budat: { type: "string", description: "전기일 YYYYMMDD (default: today; for prior-month closing 익월 1일 사용)" },
    bldat: { type: "string", description: "증빙일 YYYYMMDD (default: 카드 승인일)" },
  },
  async run({ args }) {
    const { ctx, cfg } = await loadCtx();
    const user = requireUser(cfg);

    // Resolve CRD_SEQ → card row. We need the full record for the form payload.
    const todayD = new Date();
    const oneYearAgo = new Date(todayD); oneYearAgo.setFullYear(todayD.getFullYear() - 1);
    const all = await listCardTransactions(ctx, user, {
      from: isoDate(oneYearAgo), to: isoDate(todayD),
    });
    const card: CardTransaction | undefined = all.find((c) => c.CRD_SEQ === args.crdseq);
    if (!card) {
      console.error(`CRD_SEQ ${args.crdseq} not found in last 12 months of unprocessed cards`);
      console.error(`Run \`eac corpcard list\` to see available transactions`);
      process.exit(1);
    }

    const today = `${todayD.getFullYear()}${pad(todayD.getMonth() + 1)}${pad(todayD.getDate())}`;
    const res = await createCorpCardVoucher(ctx, {
      user,
      card,
      hkont: args.hkont,
      hkontText: args["hkont-text"] ?? "",
      sgtxt: args.remark,
      budat: args.budat ?? today,
      bldat: args.bldat,
    });
    console.log(`BELNR        ${res.belnr}`);
    console.log(`MERCHANT     ${card.MERCH_NAME}`);
    console.log(`AMOUNT       ${formatWon(card.TOTAL)} (공급가 ${formatWon(card.AMOUNT)} + 부가세 ${formatWon(card.TAX)})`);
    console.log(`HKONT        ${args.hkont}${args["hkont-text"] ? "  (" + args["hkont-text"] + ")" : ""}`);
    console.log(`SGTXT        ${args.remark}`);
    console.log(``);
    console.log(`Next: eac voucher request-approval ${res.belnr} --item 법인카드 --title "${args.remark}"`);
  },
});

/* ── corpcard namespace ────────────────────────────────────────── */

export const corpcardCommand = defineCommand({
  meta: { name: "corpcard", description: "법인카드(공용) 사용내역 정산 (UD_0201_00x)." },
  subCommands: {
    list: listSub,
    create: createSub,
  },
});
