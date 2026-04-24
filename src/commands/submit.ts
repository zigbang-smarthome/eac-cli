import { defineCommand } from "citty";
import { readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { extractJSESSIONID } from "../lib/auth.ts";
import { submitExpense } from "../lib/flow.ts";
import { loadConfig, DEFAULT_CONFIG } from "../lib/config.ts";

function pad(n: number): string { return String(n).padStart(2, "0"); }

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function collectAttachments(dir: string): string[] {
  const absDir = resolve(dir);
  const files = readdirSync(absDir)
    .filter((n) => !n.startsWith(".") && statSync(join(absDir, n)).isFile())
    .map((n) => join(absDir, n));
  if (files.length === 0) throw new Error(`No attachment files in ${absDir}`);
  return files;
}

const jagiCommand = defineCommand({
  meta: {
    name: "jagi",
    description: "Submit 자기관리비 (장려지원금 FI_21). Refund = receipt × 70%.",
  },
  args: {
    month: {
      type: "string",
      required: true,
      description: "Target month YYYYMM (e.g. 202605) — also determines the attachment folder when --attach-dir is omitted",
    },
    bldat: {
      type: "string",
      required: true,
      description: "Receipt date YYYYMMDD (e.g. 20260503)",
    },
    receipt: {
      type: "string",
      required: true,
      description: "Receipt total in won (integer). Refund is computed as floor(receipt × 0.7).",
    },
    "attach-dir": {
      type: "string",
      description: "Directory containing receipt attachments. Default: ./자기관리비/<month>/",
    },
    dry: {
      type: "boolean",
      description: "Stop after 임시전표 저장 (BELNR 채번). Do not submit approval.",
    },
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

    const cfg = (await loadConfig()) ?? DEFAULT_CONFIG;
    const item = cfg.items.jagi;
    if (!item) throw new Error(`config missing items.jagi — see 'eac config show'`);

    console.log(`title: ${title}`);
    console.log(`bldat: ${args.bldat}  budat: ${today()}  WAERS: KRW`);
    console.log(`amount: ${receiptWon.toLocaleString()} × 70% = ${refundWon.toLocaleString()} 원`);
    console.log(`attachments (${attachFiles.length}):`);
    for (const f of attachFiles) console.log("  " + f);
    console.log(args.dry ? "mode: dry (임시전표까지만)" : "mode: full submit (상신까지)");

    const jsessionid = extractJSESSIONID();
    const ctx = { jsessionid, userId: cfg.user.pernr, bukrs: cfg.user.bukrs };

    const result = await submitExpense(ctx, {
      user: cfg.user,
      item,
      title,
      budat: today(),
      bldat: args.bldat,
      amountWon: refundWon,
      attachFiles,
      doSubmit: !args.dry,
    });

    console.log("");
    if (result.submitted) {
      console.log(`✅ 상신 완료`);
      console.log(`   GRONO       = ${result.grono}`);
      console.log(`   BELNR       = ${result.belnr}`);
      console.log(`   EA EVI_SEQ  = ${result.eviSeqEa}`);
      console.log(`   결재 EVI_SEQ = ${result.eviSeqDraft}`);
    } else {
      console.log(`⏸  임시전표 저장 완료 (dry run, 상신은 안 함)`);
      console.log(`   BELNR       = ${result.belnr}`);
      console.log(`   EA EVI_SEQ  = ${result.eviSeqEa}`);
    }
  },
});

export const submitCommand = defineCommand({
  meta: {
    name: "submit",
    description: "Submit a reimbursement to EAC (e-accounting).",
  },
  subCommands: {
    jagi: jagiCommand,
  },
});
