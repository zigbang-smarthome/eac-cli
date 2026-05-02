import { defineCommand, runMain } from "citty";
import { callCommand } from "./commands/call.ts";
import { voucherCommand } from "./commands/voucher.ts";
import { approvalCommand } from "./commands/approval.ts";
import { corpcardCommand } from "./commands/corpcard.ts";
import { configCommand } from "./commands/config.ts";
import { checkForUpdate } from "./lib/update-check.ts";

const main = defineCommand({
  meta: {
    name: "eac",
    description: "CLI for eac.zigbang.in (E-Accounting / UniDocu)",
  },
  subCommands: {
    voucher: voucherCommand,
    approval: approvalCommand,
    corpcard: corpcardCommand,
    call: callCommand,
    config: configCommand,
  },
});

await checkForUpdate();
runMain(main);
