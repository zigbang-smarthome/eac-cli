/**
 * CLI helpers shared across commands.
 */

import { loadConfig, DEFAULT_CONFIG } from "./config.ts";
import { extractJSESSIONID } from "./auth.ts";
import type { ClientContext } from "./client.ts";
import type { UserProfile, ReimbursementItem } from "../types/index.ts";
import type { EacConfig } from "./config.ts";

export async function loadCtx(): Promise<{ ctx: ClientContext; cfg: EacConfig }> {
  const cfg = (await loadConfig()) ?? DEFAULT_CONFIG;
  const jsessionid = extractJSESSIONID();
  const ctx: ClientContext = { jsessionid, userId: cfg.user.pernr, bukrs: cfg.user.bukrs };
  return { ctx, cfg };
}

export function resolveItem(cfg: EacConfig, name: string): ReimbursementItem {
  const item = cfg.items[name];
  if (!item) {
    const keys = Object.keys(cfg.items).join(", ") || "(none)";
    throw new Error(`config.items.${name} not found. Defined: ${keys}. Edit ~/.config/eac/config.json.`);
  }
  return item;
}

export function requireUser(cfg: EacConfig): UserProfile {
  return cfg.user;
}

export function pad(n: number): string { return String(n).padStart(2, "0"); }

export function isoDate(d: Date): string { return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; }

export function monthRange(yyyymm: string): { from: string; to: string } {
  const y = parseInt(yyyymm.slice(0, 4), 10);
  const m = parseInt(yyyymm.slice(4, 6), 10);
  const lastDay = new Date(y, m, 0).getDate();
  return { from: `${y}${pad(m)}01`, to: `${y}${pad(m)}${pad(lastDay)}` };
}

export function currentMonthRange(): { from: string; to: string } {
  const d = new Date();
  return monthRange(`${d.getFullYear()}${pad(d.getMonth() + 1)}`);
}

export function formatWon(x: string | number): string {
  const n = typeof x === "string" ? parseInt(x, 10) : x;
  return "₩" + (Number.isFinite(n) ? n.toLocaleString() : String(x));
}
