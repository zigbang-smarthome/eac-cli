import { defineCommand } from "citty";
import { loadCtx, currentMonthRange, formatWon } from "../lib/cli.ts";
import {
  APPROVAL_BOXES,
  type ApprovalBox,
  listApprovalDocs,
  showApprovalDoc,
  parseFileGroupIdFromUrl,
  recallApprovalDoc,
  findApprovalDoc,
  defaultYearRange,
} from "../lib/ops.ts";

function boxArg() {
  return {
    type: "string" as const,
    default: "progress",
    description: `Box: ${Object.keys(APPROVAL_BOXES).join(" | ")}`,
  };
}

function validateBox(v: string): ApprovalBox {
  if (!(v in APPROVAL_BOXES)) {
    throw new Error(`unknown box: ${v} (use one of ${Object.keys(APPROVAL_BOXES).join(", ")})`);
  }
  return v as ApprovalBox;
}

const listSub = defineCommand({
  meta: { name: "list", description: "List approval documents in a box." },
  args: {
    box: boxArg(),
    from: { type: "string", description: "Start date YYYYMMDD (default: first day of current month)" },
    to: { type: "string", description: "End date YYYYMMDD (default: today)" },
    evikb: { type: "string", description: "Filter by EVIKB (e.g. FI_21 for 장려지원금)" },
    title: { type: "string", description: "Filter by WF_TITLE (LIKE match)" },
  },
  async run({ args }) {
    const box = validateBox(args.box);
    const { ctx } = await loadCtx();
    const range = currentMonthRange();
    const from = args.from ?? range.from;
    const to = args.to ?? range.to;
    const rows = await listApprovalDocs(ctx, box, { from, to, evikb: args.evikb, title: args.title });
    const b = APPROVAL_BOXES[box];
    console.log(`${b.label} (${b.prog}) ${from}–${to}: ${rows.length} rows`);
    for (const x of rows) {
      const attach = x.WF_ATTACH_FLAG === "X" ? "📎" : "  ";
      console.log(
        `  ${attach} ${x.GRONO}  ${x.WF_DATE} ${x.WF_TIME}  ${(x.EVIKB_TXT ?? "").padEnd(10)}` +
        `  ${formatWon(x.WF_AMOUNT).padStart(10)}  ${x.WF_STATUS_TXT}  ${x.WF_TITLE}`,
      );
    }
  },
});

const showSub = defineCommand({
  meta: { name: "show", description: "Show approval doc details (ZUNIEFI_4207)." },
  args: {
    grono: { type: "positional", required: true, description: "GRONO, e.g. FI20260000023921" },
  },
  async run({ args }) {
    const { ctx } = await loadCtx();
    const doc = await showApprovalDoc(ctx, args.grono);
    if (!doc) {
      console.error(`no such GRONO: ${args.grono}`);
      process.exit(1);
    }
    console.log(`GRONO:           ${doc.GRONO}`);
    console.log(`BELNR:           ${doc.BELNR}`);
    console.log(`TITLE:           ${doc.BKTXT ?? doc.SGTXT}`);
    console.log(`BUDAT / BLDAT:   ${doc.BUDAT} / ${doc.BLDAT}`);
    const amountText = (doc.DMBTR_TXT ?? doc.WRBTR_TXT ?? "").trim();
    console.log(`AMOUNT:          ₩${amountText} (${doc.WAERS})`);
    console.log(`HKONT:           ${doc.HKONT} (${doc.HKONT_TXT})`);
    console.log(`KOSTL:           ${doc.KOSTL} (${doc.KOSTL_TXT})`);
    const fgid = parseFileGroupIdFromUrl(doc.URL ?? "");
    console.log(`attach EVI_SEQ:  ${fgid ?? "(none)"}`);
    if (doc.URL) console.log(`attach URL:      ${doc.URL}`);
  },
});

const recallSub = defineCommand({
  meta: {
    name: "recall",
    description: "Recall (withdraw) an in-progress approval document.",
  },
  args: {
    grono: { type: "positional", required: true, description: "GRONO to recall" },
    box: {
      type: "string",
      default: "progress",
      description: `Which box to look up the row from (default: progress): ${Object.keys(APPROVAL_BOXES).join(" | ")}`,
    },
    comment: { type: "string", default: "", description: "Optional recall comment" },
  },
  async run({ args }) {
    const box = validateBox(args.box);
    const { ctx } = await loadCtx();
    const row = await findApprovalDoc(ctx, args.grono, box, defaultYearRange());
    if (!row) {
      console.error(`GRONO ${args.grono} not found in box ${box}`);
      process.exit(1);
    }
    const msg = await recallApprovalDoc(ctx, row, args.comment);
    console.log(msg || "recalled");
  },
});

export const docCommand = defineCommand({
  meta: { name: "doc", description: "Approval document (결재문서) operations." },
  subCommands: { list: listSub, show: showSub, recall: recallSub },
});
