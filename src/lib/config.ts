/**
 * Per-user config file stored at ~/.config/eac/config.json.
 *
 * Holds the user profile (SAP fields) and reimbursement line presets so that
 * `eac voucher create --item "자기관리비" ...` doesn't require re-entering
 * PERNR/KOSTL/HKONT/결재선 every time.
 */

import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import type { UserProfile, ReimbursementItem } from "../types/index.ts";

const CONFIG_DIR = join(homedir(), ".config", "eac");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface EacConfig {
  user: UserProfile;
  items: Record<string, ReimbursementItem>; // key = preset name, e.g. "자기관리비"
}

async function ensureConfigDir(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
}

export async function loadConfig(): Promise<EacConfig | null> {
  try {
    const content = await readFile(CONFIG_FILE, "utf-8");
    return JSON.parse(content) as EacConfig;
  } catch {
    return null;
  }
}

/**
 * Strip everything that's live-refreshed or canonical-static from an in-memory
 * EacConfig, leaving only per-user identifiers worth persisting.
 *   user  → { pernr, bukrs, kostl }                  (labels live from view.do)
 *   items → { [name]: { wfLineSeq, wfLineLin1 } }    (hkont/evikb/*_Text from ITEM_PRESETS)
 */
export function toDiskShape(cfg: EacConfig) {
  return {
    user: {
      pernr: cfg.user.pernr,
      bukrs: cfg.user.bukrs,
      kostl: cfg.user.kostl,
    },
    items: Object.fromEntries(
      Object.entries(cfg.items).map(([k, v]) => [
        k, { wfLineSeq: v.wfLineSeq, wfLineLin1: v.wfLineLin1 },
      ]),
    ),
  };
}

export async function saveConfig(cfg: EacConfig): Promise<void> {
  await ensureConfigDir();
  await writeFile(CONFIG_FILE, JSON.stringify(toDiskShape(cfg), null, 2) + "\n");
}

export function configPath(): string {
  return CONFIG_FILE;
}

/**
 * Empty skeleton used by `eac config show` when no config exists yet so the
 * user sees a structurally-valid example. NOT a working profile — `eac config
 * init` auto-discovers every field from the EAC session (view.do
 * `staticProperties.user` + ZUNIEWF_2200) and writes a populated one.
 */
export const EMPTY_CONFIG: EacConfig = {
  user: {
    pernr: "",
    bukrs: "",
    kostl: "",
    // *_TXT labels are filled live by loadCtx() from view.do — never stored.
    pernrName: "",
    wfIdText: "",
    kostlText: "",
  },
  items: {},
};

/**
 * Catalog of well-known reimbursement item presets. Keyed by the user-facing name
 * (also the CLI `--item` argument). `evikbText` is what the server stamps into
 * each personal approval line's `SEQ_TXT` (e.g. `[개인]-장려지원금`), which lets
 * `eac config init` auto-wire wfLineSeq/wfLineLin1 from the user's own lines.
 *
 * `wfLineSeq` / `wfLineLin1` are intentionally absent here — they're per-user and
 * filled in at init time from ZUNIEWF_2200.
 */
export interface ItemPreset {
  hkont: string;
  hkontText: string;
  evikb: string;
  evikbText: string;
}

export const ITEM_PRESETS: Record<string, ItemPreset> = {
  // 장려지원금 (EVIKB=FI_21) — personal-reimbursement items handled by EAC.
  // 체력단련비는 flex 에서 처리하므로 여기 없음. 셋 다 같은 [개인]-장려지원금
  // 결재선을 공유한다 — wfLineSeq/wfLineLin1 은 init 때 한 번 발견 후
  // 세 item 에 동일하게 주입된다.
  "자기관리비": {
    hkont: "52010108",
    hkontText: "판)복리후생비-자기관리비",
    evikb: "FI_21",
    evikbText: "장려지원금",
  },
  "가족회식비": {
    // 서버 canonical 명칭은 "가족식사비". 사내 통용 명칭은 "가족회식비".
    hkont: "52010109",
    hkontText: "판)복리후생비-가족식사비",
    evikb: "FI_21",
    evikbText: "장려지원금",
  },
  "원격근무지원비": {
    // 복리후생비 계열이 아니라 소모품비-사무용품 계정으로 처리.
    hkont: "53050102",
    hkontText: "판)소모품비-사무용품",
    evikb: "FI_21",
    evikbText: "장려지원금",
  },
  "법인카드": {
    // hkont here is a placeholder — corpcard create takes --hkont per transaction.
    // For request-approval the row's stored HKONT is what counts; this entry just
    // carries EVIKB/wfLineSeq for the WF flow.
    hkont: "52010102",
    hkontText: "판)복리후생비-회식대",
    evikb: "FI_12",
    evikbText: "법인카드기명식",
  },
};
