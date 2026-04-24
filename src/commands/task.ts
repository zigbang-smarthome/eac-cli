/**
 * High-level task compositions built on top of the generic submit primitives.
 *
 * Each task is a recipe that sets title/amount/item based on its domain rules
 * (e.g. 자기관리비 = refund × 70% of receipt, 영수증 폴더 규칙).
 */

import { defineCommand } from "citty";
import { join } from "node:path";
import { loadCtx, requireUser, resolveItem } from "../lib/cli.ts";
import { submitExpenseFull, today } from "../lib/ops.ts";
import { collectAttachments } from "./submit.ts";

const jagiSub = defineCommand({
  meta: {
    name: "jagi",
    description: "자기관리비 상신. Refund = floor(receipt × 0.7). Item preset: 'jagi'.",
  },
  args: {
    month: {
      type: "string",
      required: true,
      description: "Target month YYYYMM (e.g. 202605). Determines default 첨부 폴더 and title year/month.",
    },
    bldat: { type: "string", required: true, description: "Receipt date YYYYMMDD" },
    receipt: { type: "string", required: true, description: "Receipt total in won (integer). Refund auto-computed." },
    "attach-dir": { type: "string", description: "Override 첨부 폴더 (default: ./자기관리비/<month>/)" },
  },
  async run({ args }) {
    if (!/^\d{6}$/.test(args.month)) throw new Error("month must be YYYYMM");
    if (!/^\d{8}$/.test(args.bldat)) throw new Error("bldat must be YYYYMMDD");
    const receiptWon = parseInt(args.receipt, 10);
    if (!Number.isFinite(receiptWon) || receiptWon <= 0) throw new Error("receipt must be a positive integer");
    const refundWon = Math.floor((receiptWon * 7) / 10);

    const yy = parseInt(args.month.slice(0, 4), 10);
    const mm = parseInt(args.month.slice(4, 6), 10);
    const title = `${yy}년 ${mm}월 자기관리비`;

    const attachDir = args["attach-dir"] ?? join("자기관리비", args.month);
    const attachFiles = collectAttachments(attachDir);

    const { ctx, cfg } = await loadCtx();
    const item = resolveItem(cfg, "jagi");

    console.log(`title:   ${title}`);
    console.log(`amount:  ${receiptWon.toLocaleString()} × 70% = ${refundWon.toLocaleString()}`);
    console.log(`attach:  ${attachFiles.length} file(s) from ${attachDir}`);

    const res = await submitExpenseFull(ctx, {
      user: requireUser(cfg),
      item,
      title,
      budat: today(),
      bldat: args.bldat,
      amountWon: refundWon,
      attachFiles,
    });
    console.log(`\n✅ ${res.message}`);
    console.log(`GRONO            = ${res.grono}`);
    console.log(`BELNR            = ${res.belnr}`);
    console.log(`EVI_SEQ (EA)     = ${res.eviSeqEa}`);
    console.log(`EVI_SEQ (draft)  = ${res.eviSeqDraft}`);
  },
});

export const taskCommand = defineCommand({
  meta: { name: "task", description: "High-level task recipes (compose submit primitives)." },
  subCommands: { jagi: jagiSub },
});
