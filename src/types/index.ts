/**
 * Shared types for the EAC CLI.
 *
 * The EAC (UniDocu) APIs expose SAP fields directly. Many types here mirror those
 * — keep key names exactly as the server expects (uppercase SAP aliases).
 */

/**
 * User profile passed into ops.ts as `user`. Fields split into two layers:
 *
 *   STORED (~/.config/eac/config.json — identity, hard for the CLI to discover)
 *     pernr, bukrs, kostl
 *
 *   LIVE   (filled by loadCtx() from view.do `staticProperties.user` each run —
 *           server-canonical display labels, refreshed every command)
 *     pernrName, wfIdText, kostlText
 */
export interface UserProfile {
  pernr: string;         // Employee number, e.g. "ZB01135"
  bukrs: string;         // Company code, e.g. "K001"
  kostl: string;         // Cost center, e.g. "226020"
  bupla: string;         // Business place, e.g. "K100" (Zigbang HQ)
  gsber: string;         // Business area — varies per business unit
                         //   (e.g. K200=Zigbang, K300=Property, others differ).
                         //   SAP rule ZFI1.213: all FI doc lines must share GSBER.
                         //   Confirm via EAC UI > EA전표작성 > 사업영역 dropdown.
  pernrName: string;     // Display name, e.g. "박영걸"     (live)
  wfIdText: string;      // "YG Park (박영걸)"               (live)
  kostlText: string;     // "Device Engineering"             (live)
}

export interface ReimbursementItem {
  /** G/L account (e.g. "52010108" = 자기관리비). */
  hkont: string;
  hkontText: string;      // "판)복리후생비-자기관리비"
  /** Document type code (e.g. "FI_21" = 장려지원금). */
  evikb: string;
  evikbText: string;      // "장려지원금"
  /** personal approval line SEQ — e.g. "0000000002" for [개인]-장려지원금. */
  wfLineSeq: string;
  wfLineLin1: string;
}

export interface ApprovalLine {
  SELECTED: string;
  WF_LINE_LEV: number;
  WF_SEQ: string;
  DISPLAY_TEXT: string;
  WF_AGREE: string;
  [k: string]: unknown;
}
