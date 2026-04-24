/**
 * Shared types for the EAC CLI.
 *
 * The EAC (UniDocu) APIs expose SAP fields directly. Many types here mirror those
 * — keep key names exactly as the server expects (uppercase SAP aliases).
 */

export interface UserProfile {
  pernr: string;         // Employee number, e.g. "ZB01135"
  bukrs: string;         // Company code, e.g. "K001"
  pernrName: string;     // Display name, e.g. "박영걸"
  wfIdText: string;      // Full display like "YG Park (박영걸)"
  kostl: string;         // Cost center, e.g. "226020"
  kostlText: string;     // "Device Engineering"
  wfDept: string;        // Department code
  wfDeptText: string;    // "Service Engineering"
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

  /** Optional preset defaults for `eac <item> submit`.
   *  If present, the per-item top-level command (e.g. `eac jagi`) will apply these
   *  conventions so the user only has to supply --month/--bldat/--receipt. */
  preset?: ItemPreset;
}

export interface ItemPreset {
  /** Title template. `{year}`, `{month}`, `{month2}` are substituted.
   *  e.g. "{year}년 {month}월 자기관리비" → "2026년 4월 자기관리비". */
  titleFormat: string;
  /** Attachment directory template. Same substitutions as titleFormat.
   *  e.g. "자기관리비/{year}{month2}" → "자기관리비/202604". */
  attachDirFormat: string;
  /** Refund rule: `receipt × rate`, floor to integer won, optionally capped. */
  refund?: { rate: number; cap?: number };
}

export interface ApprovalLine {
  SELECTED: string;
  WF_LINE_LEV: number;
  WF_SEQ: string;
  DISPLAY_TEXT: string;
  WF_AGREE: string;
  [k: string]: unknown;
}
