/**
 * `eac config` — per-user config management.
 *
 *   eac config show                          print effective config + path
 *   eac config init [--force] [--print]      discover from EAC session, prompt
 *                                            only for things the server doesn't
 *                                            expose (in practice: nothing — but
 *                                            we still confirm each value).
 */

import { defineCommand } from "citty";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  loadConfig, saveConfig, configPath, toDiskShape, EMPTY_CONFIG, ITEM_PRESETS,
  type EacConfig,
} from "../lib/config.ts";
import { ensureSession } from "../lib/auth.ts";
import { fetchViewBootstrap } from "../lib/whoami.ts";
import {
  listPersonalLines, readApprovalLineApprovers,
  type PersonalLine, type ApprovalLineMember,
} from "../lib/ops.ts";
import type { ClientContext } from "../lib/client.ts";
import type { ReimbursementItem } from "../types/index.ts";

const showCommand = defineCommand({
  meta: { name: "show", description: "Print current config (disk shape, identifiers only)." },
  async run() {
    const cfg = (await loadConfig()) ?? EMPTY_CONFIG;
    console.log(`path: ${configPath()}`);
    console.log(JSON.stringify(toDiskShape(cfg), null, 2));
  },
});

/** Format an approver chain for display: "1차 박영걸 → 2차 김지섭 → 3차 안성우". */
function formatChain(members: ApprovalLineMember[]): string {
  const ordered = [...members].sort(
    (a, b) => parseInt(a.WF_LINE_LEV || "0", 10) - parseInt(b.WF_LINE_LEV || "0", 10),
  );
  return ordered
    .map((m) => {
      const name = (m.WF_ID_TXT ?? "").replace(/^.+\(([^)]+)\)$/, "$1") || m.WF_ID_TXT || m.WF_ID || "?";
      return `${m.WF_LINE_LEV}차 ${name}`;
    })
    .join(" → ") || "(결재자 없음)";
}

const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Discover SAP fields from your EAC session and write ~/.config/eac/config.json.",
  },
  args: {
    force: { type: "boolean", description: "overwrite existing config (existing items.* presets are merged)" },
    print: { type: "boolean", description: "print resulting config to stdout instead of writing" },
    yes: { type: "boolean", description: "non-interactive — accept all auto-detected values without prompting" },
  },
  async run({ args }) {
    const existing = await loadConfig();
    if (existing && !args.force && !args.print) {
      console.error(`config already exists at ${configPath()}`);
      console.error(`  use --force to overwrite (existing items.* presets are merged), or --print for a dry run`);
      process.exit(1);
    }

    const interactive = !args.yes && process.stdin.isTTY;
    const rl = interactive ? createInterface({ input, output }) : null;
    const ask = async (label: string, fallback: string): Promise<string> => {
      if (!rl) return fallback;
      const ans = (await rl.question(fallback ? `  ${label} [${fallback}]: ` : `  ${label}: `)).trim();
      return ans || fallback;
    };

    try {
      // 1) Session
      console.error("→ EAC 세션 확인 중...");
      const jsessionid = await ensureSession();

      // 2) Pull the full user profile + cache-bust from view.do `staticProperties`
      console.error("→ view.do 에서 사용자 프로필 / cache-bust 추출...");
      const boot = await fetchViewBootstrap(jsessionid);
      if (!boot) {
        console.error("  ✗ staticProperties.user 파싱 실패 — 서버 HTML 구조가 바뀐 것 같다.");
        console.error("    수동으로 ~/.config/eac/config.json 을 작성해야 한다. README 참고.");
        process.exit(1);
      }
      const me = boot.user;
      console.error("  ✓ 자동 탐지된 값:");
      console.error(`     PERNR      ${me.pernr}  (${me.ename})`);
      console.error(`     BUKRS      ${me.bukrs}`);
      console.error(`     KOSTL      ${me.kostl}  (${me.kostlText})`);
      console.error(`     EMAIL      ${me.email}`);
      console.error(`     POS        ${me.jobName} / ${me.posName}`);
      console.error(`     requireBust=${boot.requireBust}`);

      // 3) Personal approval lines — auto-wire item presets + show approver
      //    chain so the user can verify "yes that's my line".
      const ctx: ClientContext = {
        jsessionid,
        userId: me.pernr,
        bukrs: me.bukrs,
        requireBust: boot.requireBust,
        webDataCacheBust: boot.webDataCacheBust,
      };
      console.error("\n→ ZUNIEWF_2200 (개인결재선) 조회...");
      const lines: PersonalLine[] = await listPersonalLines(ctx).catch((e) => {
        console.error(`  ✗ ${e?.message ?? e}`);
        return [];
      });
      console.error(`  ✓ ${lines.length}개 결재선 발견`);

      const detectedItems: Record<string, ReimbursementItem> = {};
      const chainCache = new Map<string, string>(); // SEQ -> formatted chain (avoid duplicate ZUNIEWF_2203 calls)
      const printed = new Set<string>();            // SEQ already shown in detail
      for (const [name, preset] of Object.entries(ITEM_PRESETS)) {
        const hit = lines.find((l) => (l.SEQ_TXT ?? "").includes(preset.evikbText));
        if (!hit) {
          console.error(`  - "${name}" 매칭 없음 (찾는 SEQ_TXT: contains "${preset.evikbText}")`);
          continue;
        }
        if (!chainCache.has(hit.SEQ)) {
          const members = await readApprovalLineApprovers(ctx, hit).catch(() => [] as ApprovalLineMember[]);
          chainCache.set(hit.SEQ, formatChain(members));
        }
        if (!printed.has(hit.SEQ)) {
          console.error(`  ✓ ${hit.SEQ_TXT}   SEQ=${hit.SEQ}  LIN1=${hit.WF_LIN1 ?? ""}`);
          console.error(`       결재자: ${chainCache.get(hit.SEQ)}`);
          console.error(`       items: "${name}"`);
          printed.add(hit.SEQ);
        } else {
          // Same approval line as a previous item — just acknowledge the share
          console.error(`       items: "${name}"  (위 결재선 공유)`);
        }
        detectedItems[name] = {
          hkont: preset.hkont,
          hkontText: preset.hkontText,
          evikb: preset.evikb,
          evikbText: preset.evikbText,
          wfLineSeq: hit.SEQ,
          wfLineLin1: hit.WF_LIN1 ?? "",
        };
      }

      // 4) Only IDs are stored. Display labels (pernrName/wfIdText/kostlText)
      //    are filled live by loadCtx() from the same view.do payload every
      //    command run — keeping them out of config means no stale labels
      //    after a department/role change.
      const defaults = { pernr: me.pernr, bukrs: me.bukrs, kostl: me.kostl };

      let ids = defaults;
      if (interactive) {
        console.error("\n식별자 확인. Enter = 그대로 사용. 일반적으로 수정할 일 없음.");
        const pernrLabel = me.ename ? `PERNR (사번) — ${me.ename}` : "PERNR (사번)";
        const kostlLabel = me.kostlText ? `KOSTL (코스트 센터) — ${me.kostlText}` : "KOSTL (코스트 센터)";
        ids = {
          pernr: await ask(pernrLabel,             defaults.pernr),
          bukrs: await ask("BUKRS (회사 코드)",      defaults.bukrs),
          kostl: await ask(kostlLabel,             defaults.kostl),
        };
      }

      // 5) Items: re-init merge only when PERNR matches (wfLineSeq is per-user)
      const samePernr = existing?.user.pernr === ids.pernr;
      if (!samePernr && existing && Object.keys(existing.items).length) {
        console.error(`\n⚠ 기존 config 의 PERNR(${existing.user.pernr}) 과 새 PERNR(${ids.pernr}) 가 달라서 기존 items 는 무시한다.`);
      }
      const cfg: EacConfig = {
        user: {
          pernr: ids.pernr,
          bukrs: ids.bukrs,
          kostl: ids.kostl,
          // Labels intentionally empty on disk — loadCtx() refreshes them.
          pernrName: "",
          wfIdText: "",
          kostlText: "",
        },
        items: samePernr
          ? { ...(existing!.items), ...detectedItems }
          : detectedItems,
      };

      if (args.print) {
        // Mirror what saveConfig() actually writes — slim disk shape.
        console.log(JSON.stringify(toDiskShape(cfg), null, 2));
        return;
      }

      await saveConfig(cfg);
      console.error(`\n✓ wrote ${configPath()}`);
      if (!ids.kostl) {
        console.error("⚠ KOSTL 가 비어있다 — voucher/corpcard create 시 실패할 수 있다.");
      }
      const missingItems = Object.keys(ITEM_PRESETS).filter((k) => !(k in cfg.items));
      if (missingItems.length) {
        console.error(`⚠ 매칭되지 않은 item 프리셋: ${missingItems.join(", ")}`);
        console.error(`   결재선 관리에서 "[개인]-장려지원금" / "[개인]-법인카드기명식" 등을 등록한 뒤 재실행.`);
      }
    } finally {
      rl?.close();
    }
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
