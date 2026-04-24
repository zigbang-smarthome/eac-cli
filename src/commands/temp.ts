import { defineCommand } from "citty";
import { loadCtx, currentMonthRange, formatWon } from "../lib/cli.ts";
import { listTempDocs, cancelTempDocGroup } from "../lib/ops.ts";

const listSub = defineCommand({
  meta: { name: "list", description: "List EA 임시전표 / 전표 (ZUNIEFI_4200)." },
  args: {
    from: { type: "string", description: "BUDAT_FR (YYYYMMDD, default: first of current month)" },
    to: { type: "string", description: "BUDAT_TO (YYYYMMDD, default: today)" },
    bstat: { type: "string", default: "*", description: 'BSTAT filter: V (임시전표) | *' },
    stats: { type: "string", default: "*", description: 'STATS filter: "" (미상신) | C (회수) | R (반려) | 2 (진행중) | 4 (승인) | *' },
    evikb: { type: "string", description: "Filter by EVIKB (FI_21 / FI_22 / ...)" },
    belnr: { type: "string", description: "Filter by BELNR" },
  },
  async run({ args }) {
    const { ctx, cfg } = await loadCtx();
    const def = currentMonthRange();
    const rows = await listTempDocs(ctx, {
      from: args.from ?? def.from,
      to: args.to ?? def.to,
      bstat: args.bstat,
      stats: args.stats,
      evikb: args.evikb,
      belnr: args.belnr,
    }, cfg.user);
    console.log(`${rows.length} rows`);
    for (const r of rows) {
      const grono = r.GRONO || "-".padEnd(16);
      console.log(
        `  ${grono}  BELNR=${r.BELNR}  ${r.BUDAT}  ${(r.EVIKB_TXT ?? "").padEnd(10)}` +
        `  ${formatWon(parseFloat(r.DMBTR ?? r.WRBTR ?? "0") | 0).padStart(10)}` +
        `  ${(r.BSTAT_TXT ?? "").padEnd(6)} / ${(r.STATS_TXT ?? "").padEnd(6)}  ${r.SGTXT ?? r.BKTXT ?? ""}`,
      );
    }
  },
});

const cancelGroupSub = defineCommand({
  meta: {
    name: "cancel-group",
    description: "Release GRONO from a 회수(recalled) temp doc (그룹번호취소, ZUNIEFI_4202).",
  },
  args: {
    grono: { type: "positional", required: true, description: "GRONO on the temp doc" },
  },
  async run({ args }) {
    const { ctx, cfg } = await loadCtx();
    const rows = await listTempDocs(ctx, {
      from: `${new Date().getFullYear()}0101`,
      to: `${new Date().getFullYear()}1231`,
      bstat: "V", stats: "C",
    }, cfg.user);
    const row = rows.find((r) => r.GRONO === args.grono);
    if (!row) {
      console.error(`no 회수 temp doc with GRONO=${args.grono} (must be in BSTAT=V, STATS=C)`);
      process.exit(1);
    }
    await cancelTempDocGroup(ctx, row);
    console.log(`GRONO ${args.grono} canceled. BELNR ${row.BELNR} is now 미상신 and ready to re-submit.`);
  },
});

export const tempCommand = defineCommand({
  meta: { name: "temp", description: "EA 전표 operations (UD_0302_000)." },
  subCommands: { list: listSub, "cancel-group": cancelGroupSub },
});
