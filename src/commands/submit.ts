/**
 * Generic expense submission primitives and composite.
 *
 *   eac submit temp         — Steps 1-5 only: 임시전표 생성 → BELNR
 *   eac submit grono        — Step 6: 기존 BELNR 에 GRONO 예약
 *   eac submit approval     — Steps 7-11: 기존 GRONO 에 결재문서 첨부 + 상신
 *   eac submit full         — Steps 1-11: end-to-end
 *
 * All commands require `--item <name>` to pick a preset from `config.items.*`.
 * For 자기관리비 convenience, see `eac task jagi`.
 */

import { defineCommand } from "citty";
import { readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadCtx, resolveItem, requireUser } from "../lib/cli.ts";
import {
  createTempDoc,
  reserveGrono,
  submitApproval,
  submitExpenseFull,
  today,
  findApprovalDoc,
  listTempDocs,
  defaultYearRange,
} from "../lib/ops.ts";

function collectAttachments(dir: string): string[] {
  const absDir = resolve(dir);
  const files = readdirSync(absDir)
    .filter((n) => !n.startsWith(".") && statSync(join(absDir, n)).isFile())
    .map((n) => join(absDir, n));
  if (files.length === 0) throw new Error(`no attachment files in ${absDir}`);
  return files;
}

const commonSubmitArgs = {
  item: { type: "string" as const, required: true, description: "Preset name from config.items (e.g. jagi)" },
  title: { type: "string" as const, required: true, description: "Document title" },
  budat: { type: "string" as const, description: "Posting date YYYYMMDD (default: today)" },
  bldat: { type: "string" as const, required: true, description: "Receipt date YYYYMMDD" },
  amount: { type: "string" as const, required: true, description: "Amount in won (integer)" },
  "attach-dir": { type: "string" as const, description: "Directory of attachment files" },
};

const tempSub = defineCommand({
  meta: { name: "temp", description: "Create 임시전표 only (Steps 1-5). Returns BELNR + EVI_SEQ." },
  args: commonSubmitArgs,
  async run({ args }) {
    const { ctx, cfg } = await loadCtx();
    const user = requireUser(cfg);
    const item = resolveItem(cfg, args.item);
    const amountWon = parseInt(args.amount, 10);
    const attachFiles = args["attach-dir"] ? collectAttachments(args["attach-dir"]) : [];
    const res = await createTempDoc(ctx, {
      user, item,
      title: args.title,
      budat: args.budat ?? today(),
      bldat: args.bldat,
      amountWon,
      attachFiles,
    });
    console.log(`BELNR    = ${res.belnr}`);
    console.log(`EVI_SEQ  = ${res.eviSeqEa}`);
    console.log(`ZFBDT    = ${res.zfbdt}`);
  },
});

const gronoSub = defineCommand({
  meta: { name: "grono", description: "Reserve a GRONO on an existing BELNR (Step 6)." },
  args: {
    item: { type: "string", required: true, description: "Preset name" },
    title: { type: "string", required: true, description: "Document title" },
    belnr: { type: "string", required: true, description: "Existing BELNR" },
    "evi-seq": { type: "string", required: true, description: "EVI_SEQ of that temp doc" },
    budat: { type: "string", description: "Posting date YYYYMMDD (default: today)" },
    bldat: { type: "string", required: true, description: "Receipt date YYYYMMDD" },
    amount: { type: "string", required: true, description: "Amount in won" },
    zfbdt: { type: "string", description: "ZFBDT YYYYMMDD. If omitted, re-computes via ZUNIEFI_4003 fallback." },
  },
  async run({ args }) {
    const { ctx, cfg } = await loadCtx();
    const grono = await reserveGrono(ctx, {
      user: requireUser(cfg),
      item: resolveItem(cfg, args.item),
      title: args.title,
      budat: args.budat ?? today(),
      bldat: args.bldat,
      zfbdt: args.zfbdt ?? defaultZfbdt(args.bldat),
      amountWon: parseInt(args.amount, 10),
      belnr: args.belnr,
      eviSeqEa: args["evi-seq"],
    });
    console.log(grono);
  },
});

const approvalSub = defineCommand({
  meta: { name: "approval", description: "Submit approval on an existing GRONO (Steps 7-11)." },
  args: {
    item: { type: "string", required: true, description: "Preset name (for HKONT/EVIKB/line)" },
    title: { type: "string", required: true, description: "Document title" },
    grono: { type: "string", required: true, description: "GRONO of the reserved doc" },
    amount: { type: "string", required: true, description: "Amount in won" },
    "attach-dir": { type: "string", required: true, description: "Directory of attachment files" },
    "i-body": { type: "string", description: "Optional inline body override" },
  },
  async run({ args }) {
    const { ctx, cfg } = await loadCtx();
    const attachFiles = collectAttachments(args["attach-dir"]);
    const res = await submitApproval(ctx, {
      user: requireUser(cfg),
      item: resolveItem(cfg, args.item),
      title: args.title,
      amountWon: parseInt(args.amount, 10),
      grono: args.grono,
      attachFiles,
      iBody: args["i-body"],
    });
    console.log(res.message);
    console.log(`EVI_SEQ(draft) = ${res.eviSeqDraft}`);
  },
});

const fullSub = defineCommand({
  meta: { name: "full", description: "End-to-end: temp doc → GRONO → approval (Steps 1-11)." },
  args: {
    item: { type: "string", required: true, description: "Preset name from config.items (e.g. jagi)" },
    title: { type: "string", required: true, description: "Document title" },
    budat: { type: "string", description: "Posting date YYYYMMDD (default: today)" },
    bldat: { type: "string", required: true, description: "Receipt date YYYYMMDD" },
    amount: { type: "string", required: true, description: "Amount in won" },
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
    console.log(`${res.message}`);
    console.log(`GRONO            = ${res.grono}`);
    console.log(`BELNR            = ${res.belnr}`);
    console.log(`EVI_SEQ (EA)     = ${res.eviSeqEa}`);
    console.log(`EVI_SEQ (draft)  = ${res.eviSeqDraft}`);
  },
});

export const submitCommand = defineCommand({
  meta: { name: "submit", description: "Generic expense submission primitives." },
  subCommands: { temp: tempSub, grono: gronoSub, approval: approvalSub, full: fullSub },
});

function defaultZfbdt(bldat: string): string {
  const y = parseInt(bldat.slice(0, 4), 10);
  const m = parseInt(bldat.slice(4, 6), 10);
  const next = new Date(y, m, 23);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}`;
}

// exports used by task commands
export { collectAttachments };
export { findApprovalDoc, listTempDocs, defaultYearRange };
