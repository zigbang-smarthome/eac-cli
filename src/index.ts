import { defineCommand, runMain } from "citty";
import { submitCommand } from "./commands/submit.ts";
import { listCommand } from "./commands/list.ts";
import { configCommand } from "./commands/config.ts";

const main = defineCommand({
  meta: {
    name: "eac",
    description: "CLI for eac.zigbang.in (E-Accounting / UniDocu)",
  },
  subCommands: {
    submit: submitCommand,
    list: listCommand,
    config: configCommand,
  },
});

runMain(main);
