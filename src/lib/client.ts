/**
 * UniDocu named-service client for eac.zigbang.in.
 *
 * All API calls go through a single endpoint shape:
 *   POST /unidocu/namedService/call.do?__namedServiceId=<id>
 * with cookie JSESSIONID, form-urlencoded body containing:
 *   - service-specific fields
 *   - `namedServiceId`
 *   - `IS_KEY_PROGRAM_ID` (determines the "program context", e.g. UD_0302_000 vs DRAFT_0010)
 *   - cache bust values (fixed today; observed not to rotate)
 *   - `staticUserID`, `staticIS_KEY_BUKRS`
 *
 * fineuploader/request.do uses the same cookie but multipart/form-data.
 */

import { ApiError } from "./errors.ts";

const BASE = "https://eac.zigbang.in";

// Cache-bust values injected by server into every page load. Observed not to rotate over days.
// If the server starts rejecting requests, refresh from a page's staticProperties.
const WEB_DATA_CACHE_BUST = "1774310304657";
const REQUIRE_BUST = "1774310304657";

export interface ClientContext {
  jsessionid: string;
  userId: string;       // staticUserID (PERNR / EAC user id, e.g. "ZB01135")
  bukrs: string;        // staticIS_KEY_BUKRS (company code, e.g. "K001")
}

export interface NSResponse {
  NSReturn?: {
    stringReturns?: Record<string, string>;
    exportMaps?: {
      OS_RETURN?: { MESSAGE?: string; ERRCODE?: string; TYPE?: string };
      [k: string]: unknown;
    };
    tableReturns?: Record<string, any>;
    returnMessage?: string | null;
  };
  [k: string]: unknown;
}

function commonHeaders(ctx: ClientContext): Record<string, string> {
  return {
    Cookie: `JSESSIONID=${ctx.jsessionid}`,
    "User-Agent": "Mozilla/5.0",
    Accept: "application/json,text/plain,*/*",
    "X-Requested-With": "XMLHttpRequest",
    Origin: BASE,
    Referer: `${BASE}/unidocu/view.do`,
  };
}

/**
 * Call a named service. Throws ApiError on HTTP non-200 or on OS_RETURN.TYPE === "E".
 */
export async function callNS(
  ctx: ClientContext,
  namedServiceId: string,
  programId: string,
  fields: Record<string, string>,
): Promise<NSResponse> {
  const body = new URLSearchParams({
    ...fields,
    namedServiceId,
    IS_KEY_PROGRAM_ID: programId,
    webDataCacheBust: WEB_DATA_CACHE_BUST,
    requireBust: REQUIRE_BUST,
    staticUserID: ctx.userId,
    staticIS_KEY_BUKRS: ctx.bukrs,
  });

  const res = await fetch(`${BASE}/unidocu/namedService/call.do?__namedServiceId=${namedServiceId}`, {
    method: "POST",
    headers: { ...commonHeaders(ctx), "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body,
  });

  const text = await res.text();
  if (res.status !== 200) {
    throw new ApiError(namedServiceId, res.status, text.slice(0, 400), text);
  }

  let json: NSResponse;
  try { json = JSON.parse(text); }
  catch { throw new ApiError(namedServiceId, res.status, "response is not JSON", text); }

  const osReturn = json?.NSReturn?.exportMaps?.OS_RETURN;
  if (osReturn?.TYPE === "E") {
    throw new ApiError(namedServiceId, res.status, osReturn.MESSAGE ?? "unknown error", text);
  }
  return json;
}

export interface UploadedFile {
  path: string;
  name: string;
  size: number;
}

/**
 * Upload a single file to a fineuploader EVI_SEQ group.
 * Server responds {"success":"true"} on success.
 */
export async function uploadFile(
  ctx: ClientContext,
  eviSeq: string,
  filePath: string,
): Promise<void> {
  const file = Bun.file(filePath);
  const name = filePath.split("/").pop() ?? "file";
  const size = file.size;
  const blob = new Blob([await file.arrayBuffer()]);
  const fd = new FormData();
  fd.append("fileGroupId", eviSeq);
  fd.append("qquuid", uuidv4());
  fd.append("qqfilename", name);
  fd.append("qqtotalfilesize", String(size));
  fd.append("qqfile", blob, name);

  const res = await fetch(`${BASE}/fineuploader/request.do`, {
    method: "POST",
    headers: commonHeaders(ctx),
    body: fd,
  });
  const text = await res.text();
  if (res.status !== 200) throw new ApiError("fineuploader/request.do", res.status, text.slice(0, 300), text);
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (json?.success !== "true" && json?.success !== true) {
    throw new ApiError("fineuploader/request.do", res.status, "upload did not return success=true", text);
  }
}

/**
 * session.do lists files currently attached to an EVI_SEQ. Used to verify uploads.
 * Server returns either JSON or XML depending on Accept; we force JSON.
 */
export interface SessionFile {
  FILE_SEQ: string;
  FILE_NAME: string;
  FILE_SIZE: number;
  USED: string;      // "" or "X" — approval link flag (set after DRAFT_0010 submit)
  GRONO: string;
  STATUS: string;
}

export async function listSession(ctx: ClientContext, eviSeq: string): Promise<SessionFile[]> {
  const res = await fetch(`${BASE}/fineuploader/session.do?EVI_SEQ=${eviSeq}&qqtimestamp=${Date.now()}`, {
    headers: { ...commonHeaders(ctx), Accept: "application/json" },
  });
  const text = await res.text();
  if (res.status !== 200) throw new ApiError("fineuploader/session.do", res.status, text.slice(0, 300), text);
  try {
    const j = JSON.parse(text);
    if (!Array.isArray(j)) return [];
    return j.map((f: any) => ({
      FILE_SEQ: String(f.FILE_SEQ ?? ""),
      FILE_NAME: String(f.FILE_NAME ?? ""),
      FILE_SIZE: parseInt(String(f.FILE_SIZE ?? "0"), 10),
      USED: String(f.USED ?? ""),
      GRONO: String(f.GRONO ?? ""),
      STATUS: String(f.STATUS ?? ""),
    }));
  } catch {
    // XML fallback — not observed with Accept: application/json but be defensive
    return [];
  }
}

function uuidv4(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
