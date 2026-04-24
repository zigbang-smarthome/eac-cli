# eac-cli

CLI for eac.zigbang.in (E-Accounting / UniDocu).

Authenticates by extracting `JSESSIONID` from the local Chrome cookie store (macOS Keychain-decrypted AES-128-CBC), then drives the UniDocu named-service API directly over plain HTTP. No headless browser at runtime.

## Install

```sh
npm install -g @zigbang-smarthome/eac-cli
brew install zigbang-smarthome/tap/eac-cli
curl -fsSL https://github.com/zigbang-smarthome/eac-cli/releases/latest/download/install.sh | sh
```

Log in to eac.zigbang.in in Chrome first so the cookie is available locally.

## Commands

```
eac
├── voucher            전표 (FI, ZUNIEFI_*)
│   ├── list                     ZUNIEFI_4200
│   ├── show <BELNR|GRONO>       ZUNIEFI_4207
│   ├── create                   전표 작성 (Steps 1-5 → BELNR)
│   ├── request-approval <BELNR> 결재요청 (Steps 6-11 → GRONO + 상신)
│   ├── cancel-group <GRONO>     그룹번호취소 (ZUNIEFI_4202)
│   └── attach new|upload|list   전표 레이어 EVI_SEQ (fineuploader)
├── approval           결재문서 (WF, ZUNIEWF_*)
│   ├── list [--box]             ZUNIEWF_4500 결재함
│   ├── recall <GRONO>           회수 (ApprovalStep+ZUNIEWF_4320)
│   ├── attach new|upload|list   결재문서 레이어 EVI_SEQ (WF_ATTACH_FLAG 트리거)
│   └── line
│       ├── list                 ZUNIEWF_2200 개인결재선
│       └── approvers <SEQ>      ZUNIEWF_4101
├── <item>             from config.items.* (e.g. jagi)
│   └── submit --month --bldat --receipt
├── call <id> --prog [--data]    raw named-service escape hatch
└── config show|init
```

## Quick examples

### 자기관리비 한 방 상신

```sh
eac jagi submit --month 202605 --bldat 20260503 --receipt 44000
```

- Title: `2026년 5월 자기관리비` (from `preset.titleFormat`)
- Amount: `floor(44000 × 0.7) = 30800` (from `preset.refund.rate`)
- Attachments: `./자기관리비/202605/*` (from `preset.attachDirFormat`)
- Runs Steps 1-11 (전표 작성 + 결재요청) including the 결재문서 레이어 첨부 필수 단계

### 회수하고 재상신

```sh
eac approval recall FI20260000023922
eac voucher cancel-group FI20260000023922
eac jagi submit --month 202604 --bldat 20260402 --receipt 44000
```

### 전표만 작성하고 나중에 결재요청

```sh
BELNR=$(eac voucher create --item jagi --title "임시" --bldat 20260503 --amount 30800 \
  --attach-dir ./자기관리비/202605 | grep ^BELNR | awk '{print $2}')

# …later…
eac voucher request-approval "$BELNR" --item jagi --title "2026년 5월 자기관리비" \
  --attach-dir ./자기관리비/202605
```

### 조회

```sh
eac voucher list                 # 임시전표 (BSTAT=V)
eac voucher list --bstat '*' --stats '*'
eac voucher show FI20260000023922
eac voucher show 3200005520      # BELNR 로도 resolve (3개월 윈도우)

eac approval list                        # 진행중 (기본)
eac approval list --box approved --from 20260101
eac approval line list
eac approval line approvers 0000000002 --grono FI20260000023922
```

### 저수준 첨부 primitive

```sh
SEQ=$(eac approval attach new)
eac approval attach upload "$SEQ" ./a.jpg,./b.pdf
eac approval attach list "$SEQ"
```

### Raw service call (wrapping 안 된 경우)

```sh
eac call ZUNIEFI_4207 --prog DRAFT_0010 --data '{"GRONO":"FI20260000023922"}'
```

## Two attachment layers (중요)

UniDocu에는 **두 개의 별도 EVI_SEQ 레이어**가 있다:

1. **전표 레이어** (`voucher attach`) — `ZUNIEFI_4006`에 연결. `voucher show`의 `attach EVI_SEQ`에 표시됨.
2. **결재문서 레이어** (`approval attach`) — `ApprovalStep` body의 `EVI_SEQ` 필드로 전달. **이게 있어야 결재함 리스트의 `WF_ATTACH_FLAG=X` (📎)가 뜬다.** 이 필드 없이 상신하면 결재자 입장에서 "첨부 누락"처럼 보임.

`eac voucher request-approval` / `eac <item> submit` 은 두 레이어 모두에 파일을 올리고 `ApprovalStep`에 결재 EVI_SEQ를 포함해서 상신한다.

## Config (`~/.config/eac/config.json`)

```json
{
  "user": {
    "pernr": "ZB01135",
    "bukrs": "K001",
    "pernrName": "박영걸",
    "wfIdText": "YG Park (박영걸)",
    "kostl": "226020",
    "kostlText": "Device Engineering",
    "wfDept": "0000252100",
    "wfDeptText": "Service Engineering"
  },
  "items": {
    "jagi": {
      "hkont": "52010108",
      "hkontText": "판)복리후생비-자기관리비",
      "evikb": "FI_21",
      "evikbText": "장려지원금",
      "wfLineSeq": "0000000002",
      "wfLineLin1": "0000000816",
      "preset": {
        "titleFormat": "{year}년 {month}월 자기관리비",
        "attachDirFormat": "자기관리비/{year}{month2}",
        "refund": { "rate": 0.7 }
      }
    }
  }
}
```

`items.*`에 추가한 preset은 자동으로 `eac <name> submit` 서브커맨드로 등록된다. e.g. `items.gaseok` 추가 → `eac gaseok submit` 바로 사용 가능.

### Preset placeholders

- `{year}` → 2026
- `{month}` → 4 (no leading zero)
- `{month2}` → 04

## Development

```sh
bun install
bun run src/index.ts --help
```

Release: `gh workflow run release.yml` — oneup가 version bump + npm/Homebrew publish 자동화.
