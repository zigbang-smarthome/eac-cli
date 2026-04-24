/**
 * 결재문서 (WF) commands — wraps ZUNIEWF_* services.
 *
 *   approval list [--box]                        ZUNIEWF_4500
 *   approval recall <GRONO>                      ApprovalStep + ZUNIEWF_4320
 *   approval attach new|upload|list              결재문서 레이어 EVI_SEQ
 *   approval line list                           ZUNIEWF_2200 (개인결재선)
 *   approval line approvers <SEQ> --grono <G>    ZUNIEWF_4101
 */

import { defineCommand } from "citty";
import { loadCtx, currentMonthRange, formatWon } from "../lib/cli.ts";
import {
  APPROVAL_BOXES, type ApprovalBox,
  listApprovalDocs, findApprovalDoc, recallApprovalDoc,
  listPersonalLines, getApprovers,
  createAttachSeq, uploadAttachments, listAttachments,
  PROG_DRAFT, defaultYearRange,
} from "../lib/ops.ts";

function validateBox(v: string): ApprovalBox {
  if (!(v in APPROVAL_BOXES)) {
    throw new Error(`unknown box: ${v} (use one of ${Object.keys(APPROVAL_BOXES).join(", ")})`);
  }
  return v as ApprovalBox;
}

/* ── list ───────────────────────────────────────────────────────── */

const listSub = defineCommand({
  meta: { name: "list", description: "결재함 조회 (ZUNIEWF_4500)." },
  args: {
    box: { type: "string", default: "progress", description: `Box: ${Object.keys(APPROVAL_BOXES).join(" | ")}` },
    from: { type: "string", description: "Start date YYYYMMDD (default: first of current month)" },
    to: { type: "string", description: "End date YYYYMMDD (default: today)" },
    evikb: { type: "string", description: "Filter by EVIKB (FI_21 / FI_22 / ...)" },
    title: { type: "string", description: "Filter by WF_TITLE" },
  },
  async run({ args }) {
    const box = validateBox(args.box);
    const { ctx } = await loadCtx();
    const def = currentMonthRange();
    const rows = await listApprovalDocs(ctx, box, {
      from: args.from ?? def.from,
      to: args.to ?? def.to,
      evikb: args.evikb,
      title: args.title,
    });
    const b = APPROVAL_BOXES[box];
    console.log(`${b.label} (${b.prog}) ${args.from ?? def.from}–${args.to ?? def.to}: ${rows.length} rows`);
    for (const x of rows) {
      const attach = x.WF_ATTACH_FLAG === "X" ? "📎" : "  ";
      console.log(
        `  ${attach} ${x.GRONO}  ${x.WF_DATE} ${x.WF_TIME}  ${(x.EVIKB_TXT ?? "").padEnd(10)}` +
        `  ${formatWon(x.WF_AMOUNT).padStart(10)}  ${x.WF_STATUS_TXT}  ${x.WF_TITLE}`,
      );
    }
  },
});

/* ── recall ─────────────────────────────────────────────────────── */

const recallSub = defineCommand({
  meta: { name: "recall", description: "결재문서 회수 (ApprovalStep + ZUNIEWF_4320)." },
  args: {
    grono: { type: "positional", required: true, description: "GRONO to recall" },
    box: { type: "string", default: "progress", description: "Where to find the row" },
    comment: { type: "string", default: "", description: "Optional recall comment" },
  },
  async run({ args }) {
    const box = validateBox(args.box);
    const { ctx } = await loadCtx();
    const row = await findApprovalDoc(ctx, args.grono, box, defaultYearRange());
    if (!row) { console.error(`GRONO ${args.grono} not found in box ${box}`); process.exit(1); }
    const msg = await recallApprovalDoc(ctx, row, args.comment);
    console.log(msg || "recalled");
  },
});

/* ── attach (결재문서 레이어 EVI_SEQ) ─────────────────────────── */

const attachNewSub = defineCommand({
  meta: { name: "new", description: "Reserve 결재문서 첨부 EVI_SEQ (ZUNIECM_5030 @ DRAFT_0010)." },
  async run() {
    const { ctx } = await loadCtx();
    const seq = await createAttachSeq(ctx, PROG_DRAFT);
    console.log(seq);
  },
});

const attachUploadSub = defineCommand({
  meta: { name: "upload", description: "Upload file(s) to a 결재문서 EVI_SEQ." },
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
  meta: { name: "list", description: "List files on a 결재문서 EVI_SEQ (session.do)." },
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
  meta: { name: "attach", description: "결재문서 첨부 (EVI_SEQ) primitives. WF_ATTACH_FLAG=X의 트리거 레이어." },
  subCommands: { new: attachNewSub, upload: attachUploadSub, list: attachListSub },
});

/* ── line (결재선) ──────────────────────────────────────────── */

const lineListSub = defineCommand({
  meta: { name: "list", description: "개인결재선 목록 (ZUNIEWF_2200)." },
  async run() {
    const { ctx } = await loadCtx();
    const lines = await listPersonalLines(ctx);
    console.log(`${lines.length} lines`);
    for (const l of lines) console.log(`  SEQ=${l.SEQ}  LIN1=${l.WF_LIN1}  ${l.SEQ_TXT}`);
  },
});

const lineApproversSub = defineCommand({
  meta: { name: "approvers", description: "결재자 리스트 (ZUNIEWF_4101)." },
  args: {
    seq: { type: "positional", required: true, description: "Line SEQ (e.g. 0000000002)" },
    grono: { type: "string", required: true, description: "GRONO under which to resolve the line" },
  },
  async run({ args }) {
    const { ctx } = await loadCtx();
    const lines = await listPersonalLines(ctx);
    const line = lines.find((l) => l.SEQ === args.seq);
    if (!line) { console.error(`line SEQ=${args.seq} not found`); process.exit(1); }
    const appr = await getApprovers(ctx, line, args.grono);
    console.log(`${line.SEQ_TXT}: ${appr.length} approvers`);
    for (const a of appr) console.log(`  L${a.WF_LINE_LEV}  SEQ=${a.WF_SEQ}  ${a.JOB_KEY_TXT ?? ""}  ${a.WF_ID_TXT ?? ""}`);
  },
});

const lineCommand = defineCommand({
  meta: { name: "line", description: "결재선 (개인결재선 + 결재자)." },
  subCommands: { list: lineListSub, approvers: lineApproversSub },
});

/* ── approval namespace ────────────────────────────────────────── */

export const approvalCommand = defineCommand({
  meta: { name: "approval", description: "결재문서 (WF) 조회/회수/첨부/결재선." },
  subCommands: {
    list: listSub,
    recall: recallSub,
    attach: attachCommand,
    line: lineCommand,
  },
});
