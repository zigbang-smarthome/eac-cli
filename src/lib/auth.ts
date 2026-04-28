/**
 * macOS Chrome cookie store → JSESSIONID extraction.
 * AES-128-CBC decrypt with key derived from "Chrome Safe Storage" keychain password.
 *
 * EAC uses Google SSO + MS Azure AD SAML chain. The login itself can't be automated
 * (2FA/SSO), so when the session is missing/expired we open Chrome at the EAC URL,
 * wait for the user to finish login, then re-read the cookie.
 */

import { Database } from "bun:sqlite";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { execSync, spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { copyFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { AuthError } from "./errors.ts";

const CHROME_COOKIES = join(homedir(), "Library/Application Support/Google/Chrome/Default/Cookies");
const KEYCHAIN_SERVICE = "Chrome Safe Storage";
const HOST_PATTERN = "%zigbang.in%";
const COOKIE_NAME = "JSESSIONID";

function getChromeMasterKey(): Buffer {
  let out: string;
  try {
    out = execSync(`security find-generic-password -s "${KEYCHAIN_SERVICE}" -g 2>&1`, { encoding: "utf-8" });
  } catch (e: any) {
    throw new AuthError(`Chrome Safe Storage keychain read failed: ${e?.message ?? e}`);
  }
  const pw = out.match(/password:\s*"([^"]+)"/)?.[1];
  if (!pw) throw new AuthError("Chrome Safe Storage keychain password not found");
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
  // Chrome v10 encrypted values on macOS prefix 32-byte sha256 hash of (host + name); strip it.
  return unpadded.subarray(32).toString("utf-8");
}

export function extractJSESSIONID(): string {
  const tmp = join(tmpdir(), `eac-${Date.now()}.db`);
  copyFileSync(CHROME_COOKIES, tmp);
  try {
    const key = getChromeMasterKey();
    const db = new Database(tmp, { readonly: true });
    const row = db
      .query<{ encrypted_value: Buffer }, [string, string]>(
        "SELECT encrypted_value FROM cookies WHERE host_key LIKE ? AND name = ? LIMIT 1",
      )
      .get(HOST_PATTERN, COOKIE_NAME);
    db.close();
    if (!row) throw new AuthError("JSESSIONID not found in Chrome cookies — log in to eac.zigbang.in in Chrome");
    return decryptV10(Buffer.from(row.encrypted_value), key);
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
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

function openChromeAtEac(): void {
  // `open -a "Google Chrome" <url>` reuses an existing Chrome window/profile.
  spawn("open", ["-a", "Google Chrome", EAC_URL], { stdio: "ignore", detached: true }).unref();
}

async function waitForEnter(): Promise<void> {
  process.stderr.write("로그인 완료 후 Enter를 눌러주세요... ");
  for await (const _ of process.stdin) break;
  process.stderr.write("\n");
}

/** Try to extract the cookie; if missing or expired, open Chrome and wait for the user. */
export async function ensureSession(): Promise<string> {
  // 1) env override always wins.
  const envToken = process.env.EAC_JSESSIONID;
  if (envToken) {
    if (await isSessionAlive(envToken)) return envToken;
    throw new AuthError("EAC_JSESSIONID is set but the session is not valid (expired or wrong cookie).");
  }

  // 2) Try Chrome keychain first. Quietly swallow "cookie not present yet" — that's the
  //    expected state when the user has never logged in to EAC in Chrome.
  let token = "";
  try { token = extractJSESSIONID(); } catch { token = ""; }
  if (token && await isSessionAlive(token)) return token;

  // 3) Need a (re-)login. Tell the user, open Chrome, wait, then re-read.
  if (!process.stdin.isTTY) {
    throw new AuthError("EAC session missing/expired and stdin is not a TTY — log in to eac.zigbang.in in Chrome and re-run, or pass EAC_JSESSIONID.");
  }
  process.stderr.write(token
    ? "EAC 세션 만료됨. Chrome에서 다시 로그인 필요.\n"
    : "EAC 세션 없음. Chrome에서 로그인 필요.\n");
  process.stderr.write([
    "",
    "  순서:",
    "    1. 열린 Chrome에서 SSO 로그인을 끝낸다.",
    "    2. Chrome을 한 번 종료(Cmd+Q)한다.  ← 디스크에 cookie flush",
    "       (안 끄면 새 JSESSIONID가 메모리에만 남아 CLI가 못 읽는다.)",
    "    3. 여기로 돌아와 Enter를 누른다.",
    "    4. 작업 끝나면 Chrome 다시 켜서 평소대로 사용.",
    "",
    "  팁: Chrome 설정 > 시작할 때 > '중단한 곳에서 계속하기'를 켜면,",
    "      종료해도 session cookie가 유지돼서 다음번 EAC 재로그인이 줄어든다.",
    "",
  ].join("\n"));
  openChromeAtEac();
  await waitForEnter();

  token = extractJSESSIONID();
  if (!await isSessionAlive(token)) {
    throw new AuthError("로그인이 확인되지 않았습니다. Chrome에서 eac.zigbang.in에 정상 로그인했는지 확인 후 다시 시도하세요.");
  }
  return token;
}
