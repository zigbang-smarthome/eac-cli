/**
 * macOS Chrome cookie store → JSESSIONID extraction.
 * AES-128-CBC decrypt with key derived from "Chrome Safe Storage" keychain password.
 */

import { Database } from "bun:sqlite";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { execSync } from "node:child_process";
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
