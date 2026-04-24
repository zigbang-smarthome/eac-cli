import { defineCommand } from "citty";
import { callNS } from "../lib/client.ts";
import { loadCtx } from "../lib/cli.ts";

export const callCommand = defineCommand({
  meta: {
    name: "call",
    description: "Raw named-service call. Escape hatch for anything not wrapped yet.",
  },
  args: {
    id: {
      type: "positional",
      required: true,
      description: "named service id, e.g. ZUNIEFI_4200",
    },
    prog: {
      type: "string",
      required: true,
      description: "IS_KEY_PROGRAM_ID context, e.g. UD_0302_000",
    },
    data: {
      type: "string",
      description: 'JSON object of service-specific fields. Example: \'{"GRONO":"FI2026..."}\'',
    },
    raw: {
      type: "boolean",
      description: "Print the full raw NSReturn JSON (default: pretty-print tableReturns+OS_RETURN only)",
    },
  },
  async run({ args }) {
    const { ctx } = await loadCtx();
    const fields: Record<string, string> = args.data ? JSON.parse(args.data) : {};
    if (!fields.tableParamsString) fields.tableParamsString = "{}";
    const res = await callNS(ctx, args.id, args.prog, fields);
    if (args.raw) {
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    const os = res?.NSReturn?.exportMaps?.OS_RETURN;
    if (os) console.log(`[${os.TYPE ?? ""} ${os.ERRCODE ?? ""}] ${os.MESSAGE ?? ""}`);
    const tables = res?.NSReturn?.tableReturns ?? {};
    for (const [name, rows] of Object.entries(tables)) {
      if (Array.isArray(rows) && rows.length) {
        console.log(`\n# ${name} (${rows.length})`);
        console.log(JSON.stringify(rows, null, 2));
      }
    }
    const sr = res?.NSReturn?.stringReturns ?? {};
    if (Object.keys(sr).length) {
      console.log(`\n# stringReturns`);
      console.log(JSON.stringify(sr, null, 2));
    }
  },
});
