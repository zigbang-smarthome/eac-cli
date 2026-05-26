/**
 * CLI helpers shared across commands.
 */

import { loadConfig, configPath, ITEM_PRESETS } from "./config.ts";
import { ensureSession } from "./auth.ts";
import { fetchViewBootstrap } from "./whoami.ts";
import type { ClientContext } from "./client.ts";
import type { UserProfile, ReimbursementItem } from "../types/index.ts";
import type { EacConfig } from "./config.ts";

export async function loadCtx(): Promise<{ ctx: ClientContext; cfg: EacConfig }> {
  const stored = await loadConfig();
  if (!stored) {
    throw new Error(`no EAC config at ${configPath()} — run 'eac config init' first.`);
  }
  if (!stored.user.pernr || !stored.user.bukrs) {
    throw new Error(`config at ${configPath()} is missing user.pernr / user.bukrs — re-run 'eac config init' or edit by hand.`);
  }
  if (!stored.user.gsber || !stored.user.bupla) {
    throw new Error(
      `config at ${configPath()} is missing user.gsber / user.bupla.\n` +
      `  SAP rule ZFI1.213 requires every FI doc line to share the same Business Area —\n` +
      `  without these the server rejects voucher creation. Re-run 'eac config init --force'.`,
    );
  }

  const jsessionid = await ensureSession();
  // Single round-trip to view.do delivers (a) the rotating cache-bust the
  // server expects in namedService bodies and (b) the canonical display
  // labels for the current user. Treat boot as mandatory — if it fails the
  // session is effectively broken for any subsequent call.
  const boot = await fetchViewBootstrap(jsessionid);
  if (!boot) {
    throw new Error(
      "EAC bootstrap (view.do) 파싱 실패 — 세션은 살아있지만 staticProperties.user 를 읽을 수 없다. SPA HTML 구조가 바뀐 듯.",
    );
  }
  if (boot.user.pernr !== stored.user.pernr) {
    // Hard fail: mixing a stored PERNR (used as staticUserID) with live labels
    // from a different person creates inconsistent SAP requests
    // (PERNR=A + PERNR_TXT=B). Force re-init instead.
    throw new Error(
      `config PERNR=${stored.user.pernr} 인데 EAC 세션은 ${boot.user.pernr} (${boot.user.ename}) 이다.\n` +
      `  → 'eac config init --force' 로 재설정하거나, 다른 브라우저 세션으로 로그인해라.`,
    );
  }

  // Overlay live labels onto stored IDs. ops.ts reads user.pernrName /
  // user.wfIdText / user.kostlText — these come from the server every run,
  // never from disk.
  //
  // Items: disk holds only { wfLineSeq, wfLineLin1 } per item; the policy
  // fields (hkont/evikb/_Text) live in ITEM_PRESETS. Merge here so ops.ts
  // sees the full ReimbursementItem.
  const items: Record<string, ReimbursementItem> = {};
  for (const [name, raw] of Object.entries(stored.items ?? {})) {
    const preset = ITEM_PRESETS[name];
    if (!preset) {
      const known = Object.keys(ITEM_PRESETS).join(", ") || "(none)";
      throw new Error(
        `config.items.${name} 가 ITEM_PRESETS 에 없다 (known: ${known}).\n` +
        `  → src/lib/config.ts 의 ITEM_PRESETS 에 추가하고 재빌드하거나,\n` +
        `    ~/.config/eac/config.json 에서 "${name}" 키를 제거해라.`,
      );
    }
    items[name] = {
      hkont: preset.hkont,
      hkontText: preset.hkontText,
      evikb: preset.evikb,
      evikbText: preset.evikbText,
      wfLineSeq: raw.wfLineSeq ?? "",
      wfLineLin1: raw.wfLineLin1 ?? "",
    };
  }

  const cfg: EacConfig = {
    user: {
      ...stored.user,
      pernrName: boot.user.sname || boot.user.ename,
      wfIdText: boot.user.ename,
      kostlText: boot.user.kostlText,
    },
    items,
  };

  const ctx: ClientContext = {
    jsessionid,
    userId: cfg.user.pernr,
    bukrs: cfg.user.bukrs,
    requireBust: boot.requireBust,
    webDataCacheBust: boot.webDataCacheBust,
  };
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
