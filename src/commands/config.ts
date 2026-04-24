import { defineCommand } from "citty";
import { loadConfig, saveConfig, configPath, DEFAULT_CONFIG } from "../lib/config.ts";

const showCommand = defineCommand({
  meta: { name: "show", description: "Print current config (merged with defaults)." },
  async run() {
    const cfg = (await loadConfig()) ?? DEFAULT_CONFIG;
    console.log(`path: ${configPath()}`);
    console.log(JSON.stringify(cfg, null, 2));
  },
});

const initCommand = defineCommand({
  meta: { name: "init", description: "Write default config to ~/.config/eac/config.json." },
  async run() {
    const existing = await loadConfig();
    if (existing) {
      console.error(`config already exists at ${configPath()} — refusing to overwrite`);
      process.exit(1);
    }
    await saveConfig(DEFAULT_CONFIG);
    console.log(`wrote default config to ${configPath()}`);
  },
});

export const configCommand = defineCommand({
  meta: {
    name: "config",
    description: "Manage per-user config (SAP fields, reimbursement presets).",
  },
  subCommands: {
    show: showCommand,
    init: initCommand,
  },
});
