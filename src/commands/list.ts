import { defineCommand } from "citty";
import { extractJSESSIONID } from "../lib/auth.ts";
import { callNS } from "../lib/client.ts";
import { loadConfig, DEFAULT_CONFIG } from "../lib/config.ts";

const BOX_MAP: Record<string, { prog: string; gb: string; label: string }> = {
  progress: { prog: "UFL_0401_020", gb: "D", label: "진행중" },
  approved: { prog: "UFL_0401_040", gb: "B", label: "승인" },
  rejected: { prog: "UFL_0401_030", gb: "C", label: "반려/회수" },
  pending:  { prog: "UFL_0401_010", gb: "A", label: "미처리" },
};

export const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List approval documents in a specific box.",
  },
  args: {
    box: {
      type: "string",
      default: "progress",
      description: `Box: ${Object.keys(BOX_MAP).join(" | ")}`,
    },
    from: {
      type: "string",
      description: "Start date YYYYMMDD (default: first day of current month)",
    },
    to: {
      type: "string",
      description: "End date YYYYMMDD (default: today)",
    },
  },
  async run({ args }) {
    const box = BOX_MAP[args.box];
    if (!box) throw new Error(`unknown box: ${args.box} (use one of ${Object.keys(BOX_MAP).join(", ")})`);

    const pad = (n: number) => String(n).padStart(2, "0");
    const today = new Date();
    const from = args.from ?? `${today.getFullYear()}${pad(today.getMonth() + 1)}01`;
    const to   = args.to   ?? `${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}`;

    const cfg = (await loadConfig()) ?? DEFAULT_CONFIG;
    const ctx = { jsessionid: extractJSESSIONID(), userId: cfg.user.pernr, bukrs: cfg.user.bukrs };

    const r = await callNS(ctx, "ZUNIEWF_4500", box.prog, {
      ST_DATE_FR: from, ST_DATE_TO: to,
      EVIKB: "", WF_ID: "", WF_ID_TXT: "",
      WF_GB: "", WF_TITLE: "", DISPLAY_GB: box.gb,
      tableParamsString: "{}",
    });
    const rows: Array<Record<string, string>> = (r?.NSReturn?.tableReturns?.OT_DATA as any) ?? [];

    console.log(`${box.label} (${box.prog}) ${from}–${to}: ${rows.length} rows`);
    for (const x of rows) {
      const attach = x.WF_ATTACH_FLAG === "X" ? "📎" : "  ";
      console.log(
        `  ${attach} ${x.GRONO}  ${x.WF_DATE} ${x.WF_TIME}  ${x.EVIKB_TXT?.padEnd(10)}` +
        `  ₩${parseInt(x.WF_AMOUNT, 10).toLocaleString().padStart(9)}  ${x.WF_STATUS_TXT}  ${x.WF_TITLE}`,
      );
    }
  },
});
