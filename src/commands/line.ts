import { defineCommand } from "citty";
import { loadCtx } from "../lib/cli.ts";
import { listPersonalLines, getApprovers } from "../lib/ops.ts";

const listSub = defineCommand({
  meta: { name: "list", description: "List personal approval lines (ZUNIEWF_2200)." },
  async run() {
    const { ctx } = await loadCtx();
    const lines = await listPersonalLines(ctx);
    console.log(`${lines.length} lines`);
    for (const l of lines) {
      console.log(`  SEQ=${l.SEQ}  LIN1=${l.WF_LIN1}  ${l.SEQ_TXT}`);
    }
  },
});

const approversSub = defineCommand({
  meta: {
    name: "approvers",
    description: "List approvers for a given line + GRONO (ZUNIEWF_4101).",
  },
  args: {
    seq: { type: "positional", required: true, description: "Line SEQ (e.g. 0000000002)" },
    grono: { type: "string", required: true, description: "GRONO under which to resolve the line" },
  },
  async run({ args }) {
    const { ctx } = await loadCtx();
    const lines = await listPersonalLines(ctx);
    const line = lines.find((l) => l.SEQ === args.seq);
    if (!line) {
      console.error(`line SEQ=${args.seq} not found. Available: ${lines.map((l) => l.SEQ).join(", ")}`);
      process.exit(1);
    }
    const appr = await getApprovers(ctx, line, args.grono);
    console.log(`${line.SEQ_TXT}: ${appr.length} approvers`);
    for (const a of appr) {
      console.log(`  L${a.WF_LINE_LEV}  SEQ=${a.WF_SEQ}  ${a.JOB_KEY_TXT ?? ""}  ${a.WF_ID_TXT ?? ""}`);
    }
  },
});

export const lineCommand = defineCommand({
  meta: { name: "line", description: "Approval line (결재선) operations." },
  subCommands: { list: listSub, approvers: approversSub },
});
