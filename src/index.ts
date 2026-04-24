import { defineCommand, runMain } from "citty";
import { callCommand } from "./commands/call.ts";
import { attachCommand } from "./commands/attach.ts";
import { docCommand } from "./commands/doc.ts";
import { tempCommand } from "./commands/temp.ts";
import { lineCommand } from "./commands/line.ts";
import { submitCommand } from "./commands/submit.ts";
import { taskCommand } from "./commands/task.ts";
import { configCommand } from "./commands/config.ts";

const main = defineCommand({
  meta: {
    name: "eac",
    description: "CLI for eac.zigbang.in (E-Accounting / UniDocu)",
  },
  subCommands: {
    call: callCommand,
    attach: attachCommand,
    doc: docCommand,
    temp: tempCommand,
    line: lineCommand,
    submit: submitCommand,
    task: taskCommand,
    config: configCommand,
  },
});

runMain(main);
