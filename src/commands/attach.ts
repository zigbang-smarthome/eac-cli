import { defineCommand } from "citty";
import { loadCtx } from "../lib/cli.ts";
import { createAttachSeq, uploadAttachments, listAttachments, PROG_LEGACY, PROG_DRAFT } from "../lib/ops.ts";

const PROG_ALIASES: Record<string, string> = {
  ea: PROG_LEGACY,
  draft: PROG_DRAFT,
};

function resolveProg(input: string): string {
  return PROG_ALIASES[input] ?? input;
}

const newSub = defineCommand({
  meta: { name: "new", description: "Reserve a new attachment EVI_SEQ (fileGroupId) via ZUNIECM_5030." },
  args: {
    prog: {
      type: "string",
      default: "draft",
      description: `Program context. Alias: ea (${PROG_LEGACY}) | draft (${PROG_DRAFT}), or pass a raw IS_KEY_PROGRAM_ID.`,
    },
  },
  async run({ args }) {
    const { ctx } = await loadCtx();
    const seq = await createAttachSeq(ctx, resolveProg(args.prog));
    console.log(seq);
  },
});

const uploadSub = defineCommand({
  meta: { name: "upload", description: "Upload one or more files to an attachment EVI_SEQ." },
  args: {
    seq: { type: "positional", required: true, description: "EVI_SEQ (fileGroupId)" },
    files: {
      type: "positional",
      required: true,
      description: "File path(s). Comma-separated or repeat the flag.",
    },
  },
  async run({ args }) {
    const { ctx } = await loadCtx();
    const paths = String(args.files).split(",").map((s) => s.trim()).filter(Boolean);
    await uploadAttachments(ctx, args.seq, paths);
    const sess = await listAttachments(ctx, args.seq);
    console.log(`${paths.length} uploaded, ${sess.length} now on seq`);
    for (const f of sess) console.log(`  ${f.FILE_SEQ}  ${f.FILE_NAME}  (${f.FILE_SIZE} B)`);
  },
});

const listSub = defineCommand({
  meta: { name: "list", description: "List files on an attachment EVI_SEQ (fineuploader/session.do)." },
  args: {
    seq: { type: "positional", required: true, description: "EVI_SEQ (fileGroupId)" },
  },
  async run({ args }) {
    const { ctx } = await loadCtx();
    const sess = await listAttachments(ctx, args.seq);
    console.log(`seq ${args.seq}: ${sess.length} files`);
    for (const f of sess) {
      const used = f.USED === "X" ? "USED" : "    ";
      console.log(`  ${f.FILE_SEQ}  ${used}  GRONO=${f.GRONO || "-".padEnd(16)}  ${f.FILE_NAME}  (${f.FILE_SIZE} B)`);
    }
  },
});

export const attachCommand = defineCommand({
  meta: { name: "attach", description: "Attachment (fineuploader EVI_SEQ) primitives." },
  subCommands: { new: newSub, upload: uploadSub, list: listSub },
});
