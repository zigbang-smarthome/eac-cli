/**
 * Per-item top-level commands, built dynamically from `config.items.*`.
 *
 * For each item preset `foo` with a `preset` block (titleFormat, attachDirFormat,
 * optionally refund rule), registers:
 *
 *   eac foo submit --month YYYYMM --bldat YYYYMMDD --receipt <won>
 *
 * The item-level command handles convention (title string, folder, refund
 * calculation) and delegates the actual flow to `submitExpenseFull`.
 */

import { defineCommand, type CommandDef } from "citty";
import { join } from "node:path";
import { loadCtx, requireUser } from "../lib/cli.ts";
import { submitExpenseFull, today } from "../lib/ops.ts";
import { collectAttachments } from "./voucher.ts";
import type { EacConfig } from "../lib/config.ts";
import type { ItemPreset } from "../types/index.ts";

function format(template: string, year: number, month: number): string {
  return template
    .replaceAll("{year}", String(year))
    .replaceAll("{month}", String(month))
    .replaceAll("{month2}", String(month).padStart(2, "0"));
}

export function buildItemCommand(name: string, cfg: EacConfig): CommandDef {
  const item = cfg.items[name];
  const preset: ItemPreset = item.preset ?? {
    titleFormat: `{year}년 {month}월 ${name}`,
    attachDirFormat: `${name}/{year}{month2}`,
  };

  const submitSub = defineCommand({
    meta: {
      name: "submit",
      description: `${name} 전체 파이프라인 (전표 작성 + 결재요청).`
        + (preset.refund ? ` Refund = receipt × ${preset.refund.rate}.` : ""),
    },
    args: {
      month: { type: "string", required: true, description: "YYYYMM (결재문서 제목/폴더용)" },
      bldat: { type: "string", required: true, description: "Receipt date YYYYMMDD" },
      receipt: {
        type: "string",
        required: !!preset.refund,
        description: preset.refund
          ? "Receipt total in won (integer). Refund auto-computed."
          : "(unused if no refund rule; use --amount to override)",
      },
      amount: { type: "string", description: "Override the final amount (bypasses refund rule)" },
      title: { type: "string", description: `Override title (default: ${preset.titleFormat})` },
      "attach-dir": { type: "string", description: `Override attach dir (default: ${preset.attachDirFormat})` },
      "i-body": { type: "string", description: "Optional inline body override" },
    },
    async run({ args }) {
      if (!/^\d{6}$/.test(args.month)) throw new Error("--month must be YYYYMM");
      if (!/^\d{8}$/.test(args.bldat)) throw new Error("--bldat must be YYYYMMDD");
      const year = parseInt(args.month.slice(0, 4), 10);
      const month = parseInt(args.month.slice(4, 6), 10);

      let amountWon: number;
      if (args.amount) {
        amountWon = parseInt(args.amount, 10);
      } else if (preset.refund && args.receipt) {
        const receipt = parseInt(args.receipt, 10);
        if (!Number.isFinite(receipt) || receipt <= 0) throw new Error("--receipt must be a positive integer");
        let refund = Math.floor(receipt * preset.refund.rate);
        if (preset.refund.cap !== undefined) refund = Math.min(refund, preset.refund.cap);
        amountWon = refund;
      } else {
        throw new Error("provide --amount (or --receipt if the item has a refund rule)");
      }
      if (!Number.isFinite(amountWon) || amountWon <= 0) throw new Error("amount must be positive");

      const title = args.title ?? format(preset.titleFormat, year, month);
      const attachDir = args["attach-dir"] ?? format(preset.attachDirFormat, year, month);
      const attachFiles = collectAttachments(attachDir);

      const { ctx } = await loadCtx();
      console.log(`title:   ${title}`);
      if (args.receipt && !args.amount) {
        console.log(`amount:  ${parseInt(args.receipt, 10).toLocaleString()} × ${preset.refund!.rate} = ${amountWon.toLocaleString()} 원`);
      } else {
        console.log(`amount:  ${amountWon.toLocaleString()} 원`);
      }
      console.log(`attach:  ${attachFiles.length} file(s) from ${attachDir}`);

      const res = await submitExpenseFull(ctx, {
        user: requireUser(cfg),
        item,
        title,
        budat: today(),
        bldat: args.bldat,
        amountWon,
        attachFiles,
        iBody: args["i-body"],
      });
      console.log(`\n✅ ${res.message}`);
      console.log(`GRONO            ${res.grono}`);
      console.log(`BELNR            ${res.belnr}`);
      console.log(`EVI_SEQ (FI)     ${res.eviSeqEa}`);
      console.log(`EVI_SEQ (draft)  ${res.eviSeqDraft}`);
    },
  });

  return defineCommand({
    meta: { name, description: `${name} (${item.evikbText ?? "expense"}) operations.` },
    subCommands: { submit: submitSub },
  });
}
