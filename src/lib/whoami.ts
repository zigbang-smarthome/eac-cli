/**
 * "Who am I" against the EAC server.
 *
 * The UniDocu SPA bootstraps its user context from a single blob inside the
 * `/unidocu/view.do` HTML:
 *
 *     staticProperties.user = JSON.parse(decodeURIComponent('...'));
 *
 * That JSON carries PERNR / BUKRS / ENAME / SNAME / KOSTL / KOSTL_TXT / DEPT
 * etc. — everything the SPA needs to populate `staticUserID` /
 * `staticIS_KEY_BUKRS` in subsequent named-service calls. We piggyback on the
 * same blob so `eac config init` doesn't have to ask the user for fields the
 * server already knows.
 *
 * Parsing is best-effort: if the regex misses (server HTML change), we return
 * `null` and the caller falls back to prompting.
 */

const EAC_URL = "https://eac.zigbang.in/unidocu/view.do";

/**
 * Subset of `staticProperties.user` we actually consume. The full record carries
 * dozens of fields (KOKRS, BUPLA, authorizedMenuInfo, ...); leave them
 * unparsed — pluck only what config init needs.
 */
export interface RemoteUser {
  pernr: string;        // PERNR
  bukrs: string;        // BUKRS (or IS_KEY_BUKRS — they're the same K001 etc.)
  ename: string;        // "Sejun Jeong (정세준)" — full display
  sname: string;        // "정세준" — Korean short name
  kostl: string;        // "343020"
  kostlText: string;    // "Frontend Hogangnono"
  bupla: string;        // "K100" (Zigbang HQ); usually populated
  gsber: string;        // "K200" / "K300"; often "" — server doesn't reliably push it,
                        //                  caller must fall back to prompt.
  email: string;        // SMTP_ADDR
  jobName: string;      // "Member" / "Manager" — title
  posName: string;      // "Frontend Engineer (Hogangnono)"
}

export interface ViewBootstrap {
  user: RemoteUser;
  /** Cache-bust value the server expects in every `namedService/call.do` body.
   *  Rotates server-side; clients that ship a stale value get
   *  `RequireBustMismatchException`. */
  requireBust: string;
  webDataCacheBust: string;
}

export async function fetchViewBootstrap(jsessionid: string): Promise<ViewBootstrap | null> {
  let html: string;
  try {
    const r = await fetch(EAC_URL, {
      headers: { Cookie: `JSESSIONID=${jsessionid}` },
      redirect: "manual",
    });
    if (r.status !== 200) return null;
    html = await r.text();
  } catch {
    return null;
  }

  // staticProperties.user = JSON.parse(decodeURIComponent('%7B...%7D'));
  const userBlob = html.match(/staticProperties\.user\s*=\s*JSON\.parse\(\s*decodeURIComponent\(\s*['"]([^'"]+)['"]\s*\)\s*\)/);
  if (!userBlob) return null;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(decodeURIComponent(userBlob[1]!));
  } catch {
    return null;
  }

  const pick = (k: string): string => {
    const v = raw[k];
    return typeof v === "string" ? v : "";
  };

  const pernr = pick("PERNR") || pick("ID");
  const bukrs = pick("BUKRS") || pick("IS_KEY_BUKRS");
  if (!pernr || !bukrs) return null;

  const requireBust =
    html.match(/staticProperties\.requireBust\s*=\s*['"]([^'"]+)['"]/)?.[1] ?? "";
  const webDataCacheBust =
    html.match(/staticProperties\.webDataCacheBust\s*=\s*['"]([^'"]+)['"]/)?.[1] ?? requireBust;
  if (!requireBust) return null;

  return {
    user: {
      pernr,
      bukrs,
      ename: pick("ENAME"),
      sname: pick("SNAME") || pick("LIFNR_TXT"),
      kostl: pick("KOSTL"),
      kostlText: pick("KOSTL_TXT"),
      bupla: pick("BUPLA"),
      gsber: pick("GSBER"),
      email: pick("SMTP_ADDR"),
      jobName: pick("JOB_NAME"),
      posName: pick("POS_NAME"),
    },
    requireBust,
    webDataCacheBust,
  };
}

/** Back-compat / convenience: just the user. */
export async function fetchRemoteUser(jsessionid: string): Promise<RemoteUser | null> {
  return (await fetchViewBootstrap(jsessionid))?.user ?? null;
}
