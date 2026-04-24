/**
 * 전표 (FI) commands — wraps ZUNIEFI_* services.
 *
 *   voucher list                         ZUNIEFI_4200
 *   voucher show <BELNR|GRONO>           ZUNIEFI_4207
 *   voucher create                       Steps 1-5 (전표 작성 → BELNR)
 *   voucher request-approval <BELNR>     Steps 6-11 (결재요청 → GRONO + 상신)
 *   voucher submit                       Steps 1-11 (create + request-approval 합성)
 *   voucher cancel-group <GRONO>         ZUNIEFI_4202 (그룹번호취소)
 *   voucher attach new|upload|list       전표 레이어 EVI_SEQ
 */

import { defineCommand } from "citty";
import { readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadCtx, resolveItem, requireUser, currentMonthRange, formatWon } from "../lib/cli.ts";
import {
  PROG_LEGACY,
  listTempDocs,
  cancelTempDocGroup,
  showApprovalDoc,
  parseFileGroupIdFromUrl,
  createTempDoc,
  reserveGrono,
  submitApproval,
  submitExpenseFull,
  createAttachSeq,
  uploadAttachments,
  listAttachments,
  today,
} from "../lib/ops.ts";

/** Last-3-months window (server caps ZUNIEFI_4200 조회 기간 to 3 months). */
function last3MonthsRange(): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - 3);
  return { from: fmt(from), to: fmt(to) };
}

function collectAttachments(dir: string): string[] {
  const absDir = resolve(dir);
  const files = readdirSync(absDir)
    .filter((n) => !n.startsWith(".") && statSync(join(absDir, n)).isFile())
    .map((n) => join(absDir, n));
  if (files.length === 0) throw new Error(`no attachment files in ${absDir}`);
  return files;
}

export { collectAttachments };

/* ── list ───────────────────────────────────────────────────────── */

const listSub = defineCommand({
  meta: { name: "list", description: "List 전표 (ZUNIEFI_4200). Defaults to BSTAT=V (임시전표)." },
  args: {
    from: { type: "string", description: "BUDAT_FR YYYYMMDD (default: first of current month)" },
    to: { type: "string", description: "BUDAT_TO YYYYMMDD (default: today)" },
    bstat: { type: "string", default: "V", description: 'BSTAT: V (임시전표) | *' },
    stats: { type: "string", default: "*", description: 'STATS: "" (미상신) | C (회수) | R (반려) | 2 (진행중) | 4 (승인) | *' },
    evikb: { type: "string", description: "Filter by EVIKB (FI_21 / FI_22 / ...)" },
    belnr: { type: "string", description: "Filter by BELNR" },
  },
  async run({ args }) {
    const { ctx, cfg } = await loadCtx();
    const def = currentMonthRange();
    const rows = await listTempDocs(ctx, {
      from: args.from ?? def.from,
      to: args.to ?? def.to,
      bstat: args.bstat,
      stats: args.stats,
      evikb: args.evikb,
      belnr: args.belnr,
    }, cfg.user);
    console.log(`${rows.length} rows`);
    for (const r of rows) {
      const grono = r.GRONO || "(no GRONO)    ";
      console.log(
        `  ${grono.padEnd(18)}  BELNR=${r.BELNR}  ${r.BUDAT}  ${(r.EVIKB_TXT ?? "").padEnd(10)}` +
        `  ${formatWon(parseInt(r.WRBTR ?? "0", 10)).padStart(10)}` +
        `  ${(r.BSTAT_TXT ?? "").padEnd(6)}/${(r.STATS_TXT ?? "").padEnd(6)}  ${r.SGTXT ?? r.BKTXT ?? ""}`,
      );
    }
  },
});

/* ── show ───────────────────────────────────────────────────────── */

const showSub = defineCommand({
  meta: { name: "show", description: "Show 전표 detail (ZUNIEFI_4207)." },
  args: {
    key: { type: "positional", required: true, description: "GRONO (FI20260000...) or BELNR" },
  },
  async run({ args }) {
    const { ctx, cfg } = await loadCtx();
    let grono = args.key;
    if (!args.key.startsWith("FI")) {
      // Resolve BELNR → GRONO via temp list. ZUNIEFI_4200 caps 조회 at 3 months.
      const rows = await listTempDocs(ctx, { ...last3MonthsRange(), belnr: args.key }, cfg.user);
      if (!rows.length) { console.error(`BELNR ${args.key} not found`); process.exit(1); }
      if (!rows[0].GRONO) {
        console.error(`BELNR ${args.key} has no GRONO yet (전표 작성만 된 상태)`);
        console.log(`BELNR      ${rows[0].BELNR}`);
        console.log(`EVI_SEQ    ${rows[0].EVI_SEQ}`);
        return;
      }
      grono = rows[0].GRONO;
    }
    const doc = await showApprovalDoc(ctx, grono);
    if (!doc) { console.error(`GRONO ${grono} not found`); process.exit(1); }
    const amountText = (doc.DMBTR_TXT ?? doc.WRBTR_TXT ?? "").trim();
    console.log(`GRONO            ${doc.GRONO}`);
    console.log(`BELNR            ${doc.BELNR}`);
    console.log(`TITLE            ${doc.BKTXT ?? doc.SGTXT}`);
    console.log(`BUDAT / BLDAT    ${doc.BUDAT} / ${doc.BLDAT}`);
    console.log(`AMOUNT           ₩${amountText} (${doc.WAERS})`);
    console.log(`HKONT            ${doc.HKONT} (${doc.HKONT_TXT})`);
    console.log(`KOSTL            ${doc.KOSTL} (${doc.KOSTL_TXT})`);
    const fgid = parseFileGroupIdFromUrl(doc.URL ?? "");
    console.log(`attach EVI_SEQ   ${fgid ?? "(none)"}`);
    if (doc.URL) console.log(`attach URL       ${doc.URL}`);
  },
});

/* ── create (Steps 1-5: 전표 작성) ──────────────────────────────── */

const createSub = defineCommand({
  meta: { name: "create", description: "전표 작성 (Steps 1-5 → BELNR). No approval yet." },
  args: {
    item: { type: "string", required: true, description: "Preset name from config.items" },
    title: { type: "string", required: true, description: "Document title" },
    budat: { type: "string", description: "Posting date YYYYMMDD (default: today)" },
    bldat: { type: "string", required: true, description: "Receipt date YYYYMMDD" },
    amount: { type: "string", required: true, description: "Amount in won (integer)" },
    "attach-dir": { type: "string", description: "Directory of attachment files (optional at create)" },
  },
  async run({ args }) {
    const { ctx, cfg } = await loadCtx();
    const res = await createTempDoc(ctx, {
      user: requireUser(cfg),
      item: resolveItem(cfg, args.item),
      title: args.title,
      budat: args.budat ?? today(),
      bldat: args.bldat,
      amountWon: parseInt(args.amount, 10),
      attachFiles: args["attach-dir"] ? collectAttachments(args["attach-dir"]) : [],
    });
    console.log(`BELNR            ${res.belnr}`);
    console.log(`EVI_SEQ (FI)     ${res.eviSeqEa}`);
    console.log(`ZFBDT            ${res.zfbdt}`);
  },
});

/* ── request-approval (Steps 6-11: 결재요청) ────────────────────── */

const requestApprovalSub = defineCommand({
  meta: { name: "request-approval", description: "결재요청 on a 전표 (Steps 6-11 → GRONO + 상신)." },
  args: {
    belnr: { type: "positional", required: true, description: "BELNR of an existing 전표 (STATS=미상신)" },
    item: { type: "string", required: true, description: "Preset name from config.items" },
    title: { type: "string", required: true, description: "Document title (used for 결재문서 제목)" },
    "attach-dir": { type: "string", required: true, description: "Directory of attachment files" },
    "i-body": { type: "string", description: "Optional inline body override" },
  },
  async run({ args }) {
    const { ctx, cfg } = await loadCtx();
    const user = requireUser(cfg);
    const item = resolveItem(cfg, args.item);

    // Resolve BELNR → row. ZUNIEFI_4200 caps at 3 months.
    const rows = await listTempDocs(ctx, {
      ...last3MonthsRange(),
      bstat: "V", stats: "*", belnr: args.belnr,
    }, user);
    const row = rows[0];
    if (!row) { console.error(`BELNR ${args.belnr} not found`); process.exit(1); }
    if (row.GRONO) {
      console.error(`BELNR ${args.belnr} already has GRONO=${row.GRONO}. Recall + cancel-group first.`);
      process.exit(1);
    }
    const amountWon = parseInt(row.WRBTR.split(".")[0], 10);
    const grono = await reserveGrono(ctx, {
      user, item,
      title: args.title,
      budat: row.BUDAT.replace(/-/g, ""),
      bldat: row.BLDAT.replace(/-/g, ""),
      zfbdt: row.ZFBDT.replace(/-/g, ""),
      amountWon,
      belnr: row.BELNR,
      eviSeqEa: row.EVI_SEQ,
    });
    const attachFiles = collectAttachments(args["attach-dir"]);
    const res = await submitApproval(ctx, {
      user, item, title: args.title, amountWon,
      grono, attachFiles, iBody: args["i-body"],
    });
    console.log(res.message);
    console.log(`GRONO            ${grono}`);
    console.log(`EVI_SEQ (draft)  ${res.eviSeqDraft}`);
  },
});

/* ── submit (Steps 1-11: create + request-approval 합성) ─────── */

const submitSub = defineCommand({
  meta: { name: "submit", description: "전표 작성 + 결재요청 한 번에 (Steps 1-11). 가장 흔한 원-샷 상신 경로." },
  args: {
    item: { type: "string", required: true, description: "Preset name from config.items" },
    title: { type: "string", required: true, description: "Document title" },
    budat: { type: "string", description: "Posting date YYYYMMDD (default: today)" },
    bldat: { type: "string", required: true, description: "Receipt date YYYYMMDD" },
    amount: { type: "string", required: true, description: "Amount in won (integer)" },
    "attach-dir": { type: "string", required: true, description: "Directory of attachment files" },
    "i-body": { type: "string", description: "Optional inline body override" },
  },
  async run({ args }) {
    const { ctx, cfg } = await loadCtx();
    const attachFiles = collectAttachments(args["attach-dir"]);
    const res = await submitExpenseFull(ctx, {
      user: requireUser(cfg),
      item: resolveItem(cfg, args.item),
      title: args.title,
      budat: args.budat ?? today(),
      bldat: args.bldat,
      amountWon: parseInt(args.amount, 10),
      attachFiles,
      iBody: args["i-body"],
    });
    console.log(res.message);
    console.log(`GRONO            ${res.grono}`);
    console.log(`BELNR            ${res.belnr}`);
    console.log(`EVI_SEQ (FI)     ${res.eviSeqEa}`);
    console.log(`EVI_SEQ (draft)  ${res.eviSeqDraft}`);
  },
});

/* ── cancel-group ──────────────────────────────────────────────── */

const cancelGroupSub = defineCommand({
  meta: { name: "cancel-group", description: "그룹번호취소 (ZUNIEFI_4202). Releases GRONO from a 회수 전표 so it can be re-submitted." },
  args: {
    grono: { type: "positional", required: true, description: "GRONO to release" },
  },
  async run({ args }) {
    const { ctx, cfg } = await loadCtx();
    const rows = await listTempDocs(ctx, {
      ...last3MonthsRange(),
      bstat: "V", stats: "C",
    }, cfg.user);
    const row = rows.find((r) => r.GRONO === args.grono);
    if (!row) { console.error(`회수 전표 with GRONO=${args.grono} not found (must be BSTAT=V, STATS=C)`); process.exit(1); }
    await cancelTempDocGroup(ctx, row);
    console.log(`GRONO ${args.grono} canceled. BELNR ${row.BELNR} is now 미상신 and ready to re-submit.`);
  },
});

/* ── attach (voucher layer EVI_SEQ) ────────────────────────────── */

const attachNewSub = defineCommand({
  meta: { name: "new", description: "Reserve a new 전표 attachment EVI_SEQ (ZUNIECM_5030 @ legacy menu)." },
  async run() {
    const { ctx } = await loadCtx();
    const seq = await createAttachSeq(ctx, PROG_LEGACY);
    console.log(seq);
  },
});

const attachUploadSub = defineCommand({
  meta: { name: "upload", description: "Upload one or more files to an EVI_SEQ." },
  args: {
    seq: { type: "positional", required: true, description: "EVI_SEQ" },
    files: { type: "positional", required: true, description: "Comma-separated file paths" },
  },
  async run({ args }) {
    const { ctx } = await loadCtx();
    const paths = String(args.files).split(",").map((s) => s.trim()).filter(Boolean);
    await uploadAttachments(ctx, args.seq, paths);
    const sess = await listAttachments(ctx, args.seq);
    console.log(`uploaded ${paths.length}, seq now has ${sess.length} files`);
  },
});

const attachListSub = defineCommand({
  meta: { name: "list", description: "List files on an EVI_SEQ (session.do)." },
  args: {
    seq: { type: "positional", required: true, description: "EVI_SEQ" },
  },
  async run({ args }) {
    const { ctx } = await loadCtx();
    const sess = await listAttachments(ctx, args.seq);
    console.log(`${sess.length} files`);
    for (const f of sess) {
      const used = f.USED === "X" ? "USED" : "    ";
      console.log(`  ${f.FILE_SEQ}  ${used}  ${f.FILE_NAME}  (${f.FILE_SIZE} B)`);
    }
  },
});

const attachCommand = defineCommand({
  meta: { name: "attach", description: "전표 첨부 (EVI_SEQ) primitives." },
  subCommands: { new: attachNewSub, upload: attachUploadSub, list: attachListSub },
});

/* ── voucher namespace ─────────────────────────────────────────── */

export const voucherCommand = defineCommand({
  meta: { name: "voucher", description: "전표 (FI) 조회/작성/결재요청/회수취소." },
  subCommands: {
    list: listSub,
    show: showSub,
    create: createSub,
    "request-approval": requestApprovalSub,
    submit: submitSub,
    "cancel-group": cancelGroupSub,
    attach: attachCommand,
  },
});
