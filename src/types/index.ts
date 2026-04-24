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
  hkont: string;          // G/L account (e.g. "52010108" = 자기관리비)
  hkontText: string;      // "판)복리후생비-자기관리비"
  evikb: string;          // Document type code (e.g. "FI_21" = 장려지원금)
  evikbText: string;      // "장려지원금"
  wfLineSeq: string;      // personal approval line SEQ — "0000000002" for [개인]-장려지원금
  wfLineLin1: string;     // WF_LIN1 tied to SEQ — "0000000816"
}

export interface ApprovalLine {
  SELECTED: string;
  WF_LINE_LEV: number;
  WF_SEQ: string;
  DISPLAY_TEXT: string;
  WF_AGREE: string;
  [k: string]: unknown;
}
