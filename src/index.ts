import { defineCommand, runMain, type SubCommandsDef } from "citty";
import { callCommand } from "./commands/call.ts";
import { voucherCommand } from "./commands/voucher.ts";
import { approvalCommand } from "./commands/approval.ts";
import { configCommand } from "./commands/config.ts";
import { buildItemCommand } from "./commands/item.ts";
import { loadConfig, DEFAULT_CONFIG } from "./lib/config.ts";

async function buildSubCommands(): Promise<SubCommandsDef> {
  const cfg = (await loadConfig()) ?? DEFAULT_CONFIG;
  const items: SubCommandsDef = {};
  for (const name of Object.keys(cfg.items)) {
    items[name] = buildItemCommand(name, cfg);
  }
  return {
    // domain namespaces
    voucher: voucherCommand,
    approval: approvalCommand,
    // escape hatch
    call: callCommand,
    // meta
    config: configCommand,
    // per-item top-level commands (from config.items.*)
    ...items,
  };
}

const main = defineCommand({
  meta: {
    name: "eac",
    description: "CLI for eac.zigbang.in (E-Accounting / UniDocu)",
  },
  subCommands: await buildSubCommands(),
});

runMain(main);
