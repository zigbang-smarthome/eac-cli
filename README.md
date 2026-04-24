# eac-cli

CLI for eac.zigbang.in (E-Accounting / UniDocu).

Authenticates by extracting `JSESSIONID` from the local Chrome cookie store (macOS Keychain-decrypted AES-128-CBC), then drives the UniDocu named-service API directly.

## Install

```sh
# npm (pulls the platform-specific binary from GitHub Releases on postinstall)
npm install -g @zigbang-smarthome/eac-cli

# Homebrew
brew install zigbang-smarthome/tap/eac-cli

# Direct (curl | sh)
curl -fsSL https://github.com/zigbang-smarthome/eac-cli/releases/latest/download/install.sh | sh
```

## Quick start

Log in to eac.zigbang.in in Chrome first so the cookie is available locally.

```sh
# 자기관리비 상신 (2026년 5월분, 영수증 날짜 2026-05-03, 영수증 44,000원)
eac submit jagi --month 202605 --bldat 20260503 --receipt 44000

# 첨부 폴더 명시
eac submit jagi --month 202605 --bldat 20260503 --receipt 44000 \
  --attach-dir ./자기관리비/202605

# 임시전표만 발행 (상신은 안 함)
eac submit jagi --month 202605 --bldat 20260503 --receipt 44000 --dry

# 진행중 결재문서 리스트
eac list --box progress

# 반려/회수 리스트
eac list --box rejected

# config 보기/초기화
eac config show
eac config init
```

## Submit flow (자기관리비)

The `submit jagi` command runs the full 11-step pipeline in one call:

1. `ZUNIEFI_4003` — 기본값 계산 (ZFBDT 등)
2. `ZUNIECM_5030` (EA 메뉴) — EA 전표용 EVI_SEQ 채번
3. `fineuploader/request.do` — EA 전표 영수증 업로드
4. `ZUNIEFI_4006` — 비용항목 저장
5. `ZUNIEFI_5000` — SAP posting (BELNR 채번)
6. `ZUNIEFI_4203` — GRONO 예약
7. `ZUNIECM_5030` (DRAFT_0010) — **결재문서용 EVI_SEQ 채번** ← 결재 첨부 레이어
8. `fineuploader/request.do` — 결재문서 EVI_SEQ에 영수증 재업로드
9. `ZUNIEWF_2200` — 개인결재선 목록 조회
10. `ZUNIEWF_4101` — 결재자 리스트 조회
11. `ApprovalStep` — 최종 상신 (`EVI_SEQ=<결재문서 EVI_SEQ>` 필수; 이 필드가 `WF_ATTACH_FLAG=X`의 트리거)

Steps 7–8 와 Step 11의 `EVI_SEQ` 필드 없이도 상신은 되지만 결재자 쪽 결재문서 리스트에 첨부 아이콘이 뜨지 않아 "첨부 누락" 상태가 된다.

## Config

`~/.config/eac/config.json`. SAP 필드(PERNR/BUKRS/KOSTL/HKONT 등)와 결재선 preset을 담는다. 없으면 shipped defaults (박영걸/ZB01135 기준) 사용.

## Development

```sh
bun install
bun run src/index.ts --help
```

Release via `gh workflow run release.yml` — oneup가 version bump + publish-npm/publish-homebrew 자동화.
