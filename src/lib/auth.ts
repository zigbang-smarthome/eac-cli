/**
 * macOS Chromium-family cookie store → JSESSIONID extraction.
 * AES-128-CBC decrypt with key derived from "<Browser> Safe Storage" keychain password.
 *
 * Supports Chrome, Microsoft Edge, and Brave — all use the same v10 cookie format
 * (PBKDF2(saltysalt, 1003, sha1) → AES-128-CBC), just with different on-disk paths
 * and different keychain service names. Override autodetect with EAC_BROWSER=<key>.
 *
 * EAC uses Google SSO + MS Azure AD SAML chain. The login itself can't be automated
 * (2FA/SSO), so when the session is missing/expired we open the detected browser at
 * the EAC URL, wait for the user to finish login, then re-read the cookie.
 */

import { Database } from "bun:sqlite";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { execSync, spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { existsSync, copyFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { AuthError } from "./errors.ts";

interface BrowserSpec {
  key: string;             // env-override token: "chrome" | "edge" | "brave"
  label: string;           // human label for prompts
  cookiePath: string;      // absolute path to the SQLite Cookies file
  keychainService: string; // `security find-generic-password -s ...`
  appName: string;         // `open -a "<appName>" <url>` to launch / focus
}

const BROWSERS: BrowserSpec[] = [
  {
    key: "chrome",
    label: "Google Chrome",
    cookiePath: join(homedir(), "Library/Application Support/Google/Chrome/Default/Cookies"),
    keychainService: "Chrome Safe Storage",
    appName: "Google Chrome",
  },
  {
    key: "edge",
    label: "Microsoft Edge",
    cookiePath: join(homedir(), "Library/Application Support/Microsoft Edge/Default/Cookies"),
    keychainService: "Microsoft Edge Safe Storage",
    appName: "Microsoft Edge",
  },
  {
    key: "brave",
    label: "Brave",
    cookiePath: join(homedir(), "Library/Application Support/BraveSoftware/Brave-Browser/Default/Cookies"),
    keychainService: "Brave Safe Storage",
    appName: "Brave Browser",
  },
];

const HOST_PATTERN = "%zigbang.in%";
const COOKIE_NAME = "JSESSIONID";

function getBrowserMasterKey(b: BrowserSpec): Buffer {
  let out: string;
  try {
    out = execSync(`security find-generic-password -s "${b.keychainService}" -g 2>&1`, { encoding: "utf-8" });
  } catch (e: any) {
    throw new AuthError(`${b.keychainService} keychain read failed: ${e?.message ?? e}`);
  }
  const pw = out.match(/password:\s*"([^"]+)"/)?.[1];
  if (!pw) throw new AuthError(`${b.keychainService} keychain password not found`);
  return pbkdf2Sync(pw, "saltysalt", 1003, 16, "sha1");
}

function decryptV10(encrypted: Buffer, key: Buffer): string {
  if (!encrypted?.length) return "";
  if (encrypted.subarray(0, 3).toString("utf-8") !== "v10") return encrypted.toString("utf-8");
  const iv = Buffer.from(" ".repeat(16), "utf-8");
  const d = createDecipheriv("aes-128-cbc", key, iv);
  d.setAutoPadding(false);
  const out = Buffer.concat([d.update(encrypted.subarray(3)), d.final()]);
  const pad = out[out.length - 1]!;
  const unpadded = pad > 0 && pad <= 16 ? out.subarray(0, out.length - pad) : out;
  // Chromium v10 encrypted values on macOS (Chrome/Edge/Brave — same OSCrypt impl) prefix
  // a 32-byte sha256 hash of (host + name); strip it.
  return unpadded.subarray(32).toString("utf-8");
}

function readCookieFromBrowser(b: BrowserSpec): string {
  if (!existsSync(b.cookiePath)) {
    throw new AuthError(`${b.label} cookie store not found at ${b.cookiePath}`);
  }
  const tmp = join(tmpdir(), `eac-${b.key}-${Date.now()}.db`);
  copyFileSync(b.cookiePath, tmp);
  try {
    const key = getBrowserMasterKey(b);
    const db = new Database(tmp, { readonly: true });
    const row = db
      .query<{ encrypted_value: Buffer }, [string, string]>(
        "SELECT encrypted_value FROM cookies WHERE host_key LIKE ? AND name = ? LIMIT 1",
      )
      .get(HOST_PATTERN, COOKIE_NAME);
    db.close();
    if (!row) throw new AuthError(`JSESSIONID not found in ${b.label} cookies — log in to eac.zigbang.in in ${b.label}`);
    return decryptV10(Buffer.from(row.encrypted_value), key);
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

function resolveBrowsers(): BrowserSpec[] {
  const env = process.env.EAC_BROWSER?.trim().toLowerCase();
  if (!env) return BROWSERS;
  const pick = BROWSERS.find((b) => b.key === env);
  if (!pick) {
    throw new AuthError(`EAC_BROWSER="${env}" not recognized. Use one of: ${BROWSERS.map((b) => b.key).join(", ")}`);
  }
  return [pick];
}

/**
 * Try each candidate browser in order. Returns `{ token, browser }` for the first
 * one that yields a cookie (regardless of liveness — caller verifies). When none
 * yield a cookie the last error is thrown so the user sees the failure mode.
 */
export function extractJSESSIONID(): { token: string; browser: BrowserSpec } {
  const candidates = resolveBrowsers();
  let lastErr: unknown = null;
  for (const b of candidates) {
    if (!existsSync(b.cookiePath)) continue;
    try {
      const token = readCookieFromBrowser(b);
      if (token) return { token, browser: b };
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  throw new AuthError(
    `No supported browser cookie store found (looked for: ${candidates.map((b) => b.label).join(", ")}). ` +
    `Log in to eac.zigbang.in in one of them, or set EAC_JSESSIONID directly.`,
  );
}

const EAC_URL = "https://eac.zigbang.in/unidocu/view.do";

/** Returns true if the JSESSIONID is accepted by EAC (server returns the SPA HTML, not a redirect to login). */
export async function isSessionAlive(jsessionid: string): Promise<boolean> {
  if (!jsessionid) return false;
  try {
    const r = await fetch(EAC_URL, {
      method: "GET",
      headers: { Cookie: `JSESSIONID=${jsessionid}` },
      redirect: "manual",
    });
    // 200 = logged in (SPA shell). 302 redirect to /oAuth/googleLogin = expired.
    return r.status === 200;
  } catch {
    return false;
  }
}

function openBrowserAtEac(b: BrowserSpec): void {
  // `open -a "<App>" <url>` reuses an existing window/profile of that browser.
  spawn("open", ["-a", b.appName, EAC_URL], { stdio: "ignore", detached: true }).unref();
}

async function waitForEnter(): Promise<void> {
  process.stderr.write("로그인 완료 후 Enter를 눌러주세요... ");
  for await (const _ of process.stdin) break;
  process.stderr.write("\n");
}

/** Try to extract the cookie; if missing or expired, open the detected browser and wait. */
export async function ensureSession(): Promise<string> {
  // 1) env override always wins.
  const envToken = process.env.EAC_JSESSIONID;
  if (envToken) {
    if (await isSessionAlive(envToken)) return envToken;
    throw new AuthError("EAC_JSESSIONID is set but the session is not valid (expired or wrong cookie).");
  }

  // 2) Try each supported browser; quietly swallow "no cookie" — expected when the
  //    user has never logged in to EAC in that browser.
  let token = "";
  let browser: BrowserSpec | null = null;
  try {
    const r = extractJSESSIONID();
    token = r.token;
    browser = r.browser;
  } catch {
    token = "";
  }
  if (token && (await isSessionAlive(token))) return token;

  // 3) Need a (re-)login. Pick a browser to open: the one whose cookie we read
  //    (even if expired), else the first candidate that exists on disk, else
  //    fall back to the first entry.
  const target =
    browser ??
    resolveBrowsers().find((b) => existsSync(b.cookiePath)) ??
    resolveBrowsers()[0]!;

  if (!process.stdin.isTTY) {
    throw new AuthError(
      `EAC session missing/expired and stdin is not a TTY — log in to eac.zigbang.in in ${target.label} and re-run, or pass EAC_JSESSIONID.`,
    );
  }
  process.stderr.write(token
    ? `EAC 세션 만료됨. ${target.label} 에서 다시 로그인 필요.\n`
    : `EAC 세션 없음. ${target.label} 에서 로그인 필요.\n`);
  process.stderr.write([
    "",
    "  순서:",
    `    1. 열린 ${target.label} 에서 SSO 로그인을 끝낸다.`,
    `    2. ${target.label} 을 한 번 종료(Cmd+Q)한다.  ← 디스크에 cookie flush`,
    "       (안 끄면 새 JSESSIONID가 메모리에만 남아 CLI가 못 읽는다.)",
    "    3. 여기로 돌아와 Enter를 누른다.",
    `    4. 작업 끝나면 ${target.label} 다시 켜서 평소대로 사용.`,
    "",
    `  팁: ${target.label} 설정 > 시작할 때 > '중단한 곳에서 계속하기'를 켜면,`,
    "      종료해도 session cookie가 유지돼서 다음번 EAC 재로그인이 줄어든다.",
    "",
    "  (다른 브라우저를 쓰려면 EAC_BROWSER=chrome|edge|brave 로 강제.)",
    "",
  ].join("\n"));
  openBrowserAtEac(target);
  await waitForEnter();

  const r = extractJSESSIONID();
  if (!(await isSessionAlive(r.token))) {
    throw new AuthError(
      `로그인이 확인되지 않았습니다. ${r.browser.label} 에서 eac.zigbang.in 에 정상 로그인했는지 확인 후 다시 시도하세요.`,
    );
  }
  return r.token;
}
