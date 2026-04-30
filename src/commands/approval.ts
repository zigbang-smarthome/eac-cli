/**
 * 결재문서 (WF) commands — wraps ZUNIEWF_* services.
 *
 *   approval list [--box]                        ZUNIEWF_4500
 *   approval recall <GRONO>                      ApprovalStep + ZUNIEWF_4320
 *   approval attach new|upload|list              결재문서 레이어 EVI_SEQ
 *
 *   approval line list                           ZUNIEWF_2200 (개인결재선)
 *   approval line show <SEQ>                     ZUNIEWF_2203 — line + approvers
 *   approval line approvers <SEQ> --grono <G>    ZUNIEWF_4101 — for a specific GRONO
 *   approval line save <SEQ> <approvers.json>    ZUNIEWF_2201 — overwrite approvers
 *   approval line add <SEQ> <wf_id> [--at level]  read → splice → save
 *   approval line remove <SEQ> <level>            read → splice → save
 *   approval line search-user <name>             ZUNIEWF_1035
 */

import { defineCommand } from "citty";
import { readFileSync } from "node:fs";
import { loadCtx, currentMonthRange, formatWon } from "../lib/cli.ts";
import {
  APPROVAL_BOXES, type ApprovalBox,
  listApprovalDocs, findApprovalDoc, recallApprovalDoc,
  listPersonalLines, getApprovers,
  readApprovalLineApprovers, saveApprovalLineApprovers,
  searchUsers,
  createAttachSeq, uploadAttachments, listAttachments,
  PROG_DRAFT, PROG_APPROVAL_LINE, defaultYearRange,
  type ApprovalLineMember,
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
    // Default 3-month rolling window inside findApprovalDoc — server caps
    // ZUNIEWF_4500 at "최대 3개월" so don't pass defaultYearRange() (12 months).
    const row = await findApprovalDoc(ctx, args.grono, box);
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
    const lines = await listPersonalLines(ctx, PROG_APPROVAL_LINE);
    console.log(`${lines.length} lines`);
    for (const l of lines) console.log(`  SEQ=${l.SEQ}  LIN1=${l.WF_LIN1}  ${l.SEQ_TXT}`);
  },
});

const lineShowSub = defineCommand({
  meta: { name: "show", description: "결재선 + 결재자 (ZUNIEWF_2203)." },
  args: {
    seq: { type: "positional", required: true, description: "Line SEQ (e.g. 0000000003)" },
    json: { type: "boolean", description: "Print raw approver JSON (use with `line save`)" },
  },
  async run({ args }) {
    const { ctx } = await loadCtx();
    const lines = await listPersonalLines(ctx, PROG_APPROVAL_LINE);
    const line = lines.find((l) => l.SEQ === args.seq);
    if (!line) { console.error(`line SEQ=${args.seq} not found`); process.exit(1); }
    const appr = await readApprovalLineApprovers(ctx, line);
    if (args.json) { console.log(JSON.stringify(appr, null, 2)); return; }
    console.log(`${line.SEQ_TXT}  (SEQ=${line.SEQ}, WF_LIN1=${line.WF_LIN1})`);
    console.log(`  ${appr.length} approvers`);
    for (const a of appr) {
      console.log(`  L${a.WF_LINE_LEV}  ${a.JOB_KEY_TXT}  ${a.WF_ID_TXT}  (WF_ID=${a.WF_ID}, NODE=${a.NODE_KEY_TXT})`);
    }
  },
});

const lineApproversSub = defineCommand({
  meta: { name: "approvers", description: "특정 GRONO에 대한 결재자 리스트 (ZUNIEWF_4101)." },
  args: {
    seq: { type: "positional", required: true, description: "Line SEQ (e.g. 0000000002)" },
    grono: { type: "string", required: true, description: "GRONO under which to resolve the line" },
  },
  async run({ args }) {
    const { ctx } = await loadCtx();
    const lines = await listPersonalLines(ctx, PROG_APPROVAL_LINE);
    const line = lines.find((l) => l.SEQ === args.seq);
    if (!line) { console.error(`line SEQ=${args.seq} not found`); process.exit(1); }
    const appr = await getApprovers(ctx, line, args.grono);
    console.log(`${line.SEQ_TXT}: ${appr.length} approvers`);
    for (const a of appr) console.log(`  L${a.WF_LINE_LEV}  SEQ=${a.WF_SEQ}  ${a.JOB_KEY_TXT ?? ""}  ${a.WF_ID_TXT ?? ""}`);
  },
});

const lineSaveSub = defineCommand({
  meta: { name: "save", description: "결재자 리스트 통째 저장 (ZUNIEWF_2201). approvers.json은 `line show --json` 출력 형식." },
  args: {
    seq: { type: "positional", required: true, description: "Line SEQ" },
    file: { type: "positional", required: true, description: "Path to JSON array of ApprovalLineMember rows" },
  },
  async run({ args }) {
    const { ctx } = await loadCtx();
    const lines = await listPersonalLines(ctx, PROG_APPROVAL_LINE);
    const line = lines.find((l) => l.SEQ === args.seq);
    if (!line) { console.error(`line SEQ=${args.seq} not found`); process.exit(1); }
    const data = JSON.parse(readFileSync(args.file, "utf-8")) as ApprovalLineMember[];
    if (!Array.isArray(data)) { console.error("file must contain a JSON array"); process.exit(1); }
    await saveApprovalLineApprovers(ctx, line, data);
    console.log(`saved ${data.length} approvers to ${line.SEQ_TXT}`);
  },
});

function userToMember(u: { WF_ID: string; WF_ID_TXT: string; JOB_KEY: string; JOB_KEY_TXT: string; NODE_KEY: string; NODE_KEY_TXT: string; POS_KEY: string; POS_KEY_TXT: string; BUKRS?: string }): ApprovalLineMember {
  return {
    SELECTED: "0",
    WF_LINE_LEV: "0",
    WF_SEQ: "0",
    DISPLAY_TEXT: `${u.JOB_KEY_TXT} ${u.WF_ID_TXT}`.trim(),
    WF_AGRET: "", WF_AGREE: "", WF_FINAN: "",
    BUKRS: "", WF_TYPE: "", WF_USER: "",
    JOB_KEY: u.JOB_KEY, JOB_KEY_TXT: u.JOB_KEY_TXT,
    NODE_KEY: u.NODE_KEY, NODE_KEY_TXT: u.NODE_KEY_TXT,
    POS_KEY: u.POS_KEY, POS_KEY_TXT: u.POS_KEY_TXT,
    WF_ID: u.WF_ID, WF_ID_TXT: u.WF_ID_TXT,
    WF_USER_TXT: "",
  };
}

const lineAddSub = defineCommand({
  meta: { name: "add", description: "결재선에 결재자 추가 (read → splice → ZUNIEWF_2201)." },
  args: {
    seq: { type: "positional", required: true, description: "Line SEQ" },
    user: { type: "positional", required: true, description: "User search term (이름 일부, e.g. 'Leah' or '송현아') OR WF_ID (e.g. ZB01010)" },
    at: { type: "string", description: "Insert position (1-based). Default: append" },
  },
  async run({ args }) {
    const { ctx } = await loadCtx();
    const lines = await listPersonalLines(ctx, PROG_APPROVAL_LINE);
    const line = lines.find((l) => l.SEQ === args.seq);
    if (!line) { console.error(`line SEQ=${args.seq} not found`); process.exit(1); }
    const hits = await searchUsers(ctx, args.user, PROG_APPROVAL_LINE);
    if (hits.length === 0) { console.error(`no user matched: ${args.user}`); process.exit(1); }
    if (hits.length > 1) {
      console.error(`${hits.length} users matched — be more specific:`);
      for (const h of hits) console.error(`  ${h.WF_ID}  ${h.WF_ID_TXT}  (${h.NODE_KEY_TXT})`);
      process.exit(1);
    }
    const member = userToMember(hits[0]!);
    const current = await readApprovalLineApprovers(ctx, line);
    const at = args.at ? Math.max(0, Math.min(current.length, parseInt(args.at, 10) - 1)) : current.length;
    const next = [...current.slice(0, at), member, ...current.slice(at)];
    await saveApprovalLineApprovers(ctx, line, next);
    console.log(`added ${member.WF_ID_TXT} at level ${at + 1} → ${line.SEQ_TXT} (${next.length} approvers)`);
  },
});

const lineRemoveSub = defineCommand({
  meta: { name: "remove", description: "결재선에서 결재자 제거 (read → splice → ZUNIEWF_2201)." },
  args: {
    seq: { type: "positional", required: true, description: "Line SEQ" },
    level: { type: "positional", required: true, description: "Level (1-based) to remove, OR WF_ID" },
  },
  async run({ args }) {
    const { ctx } = await loadCtx();
    const lines = await listPersonalLines(ctx, PROG_APPROVAL_LINE);
    const line = lines.find((l) => l.SEQ === args.seq);
    if (!line) { console.error(`line SEQ=${args.seq} not found`); process.exit(1); }
    const current = await readApprovalLineApprovers(ctx, line);
    let idx = -1;
    const asNum = parseInt(args.level, 10);
    if (!Number.isNaN(asNum) && String(asNum) === args.level) {
      idx = asNum - 1;
    } else {
      idx = current.findIndex((m) => m.WF_ID === args.level);
    }
    if (idx < 0 || idx >= current.length) {
      console.error(`approver not found: ${args.level}`);
      console.error("current:");
      for (const a of current) console.error(`  L${a.WF_LINE_LEV}  ${a.WF_ID}  ${a.WF_ID_TXT}`);
      process.exit(1);
    }
    const removed = current[idx]!;
    const next = current.filter((_, i) => i !== idx);
    await saveApprovalLineApprovers(ctx, line, next);
    console.log(`removed ${removed.WF_ID_TXT} from ${line.SEQ_TXT} (${next.length} approvers left)`);
  },
});

const lineSearchUserSub = defineCommand({
  meta: { name: "search-user", description: "EAC 사용자 검색 (ZUNIEWF_1035)." },
  args: {
    name: { type: "positional", required: true, description: "Name fragment (Korean or English)" },
  },
  async run({ args }) {
    const { ctx } = await loadCtx();
    const hits = await searchUsers(ctx, args.name, PROG_APPROVAL_LINE);
    console.log(`${hits.length} hits`);
    for (const h of hits) {
      console.log(`  ${h.WF_ID}  ${h.JOB_KEY_TXT.padEnd(8)}  ${h.WF_ID_TXT.padEnd(30)}  ${h.NODE_KEY_TXT}`);
    }
  },
});

const lineCommand = defineCommand({
  meta: { name: "line", description: "결재선 (개인결재선 + 결재자)." },
  subCommands: {
    list: lineListSub,
    show: lineShowSub,
    approvers: lineApproversSub,
    save: lineSaveSub,
    add: lineAddSub,
    remove: lineRemoveSub,
    "search-user": lineSearchUserSub,
  },
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
