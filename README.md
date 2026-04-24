# eac-cli

CLI for eac.zigbang.in (E-Accounting / UniDocu).

Authenticates by extracting `JSESSIONID` from the local Chrome cookie store (macOS Keychain-decrypted AES-128-CBC), then drives the UniDocu named-service API directly over plain HTTP. No headless browser at runtime.

## Install

```sh
npm install -g @zigbang-smarthome/eac-cli                   # npm
brew install zigbang-smarthome/tap/eac-cli                  # Homebrew
curl -fsSL https://github.com/zigbang-smarthome/eac-cli/releases/latest/download/install.sh | sh
```

Log in to eac.zigbang.in in Chrome first so the cookie is available locally.

## Commands

```
eac
├── call <id> --prog <p> [--data <json>]    # raw named-service call (escape hatch)
├── attach
│   ├── new --prog <ea|draft|...>           # ZUNIECM_5030 → new EVI_SEQ
│   ├── upload <seq> <files>                # fineuploader/request.do
│   └── list <seq>                          # session.do → files on seq
├── doc                                     # 결재문서 (ZUNIEWF_4500)
│   ├── list [--box progress|approved|rejected|pending]
│   ├── show <grono>                        # ZUNIEFI_4207
│   └── recall <grono>                      # ApprovalStep + ZUNIEWF_4320
├── temp                                    # EA 전표 (UD_0302_000)
│   ├── list [--bstat V] [--stats C] ...    # ZUNIEFI_4200
│   └── cancel-group <grono>                # ZUNIEFI_4202 (releases GRONO on 회수 doc)
├── line                                    # 개인결재선
│   ├── list                                # ZUNIEWF_2200
│   └── approvers <seq> --grono <g>         # ZUNIEWF_4101
├── submit                                  # generic expense submission primitives
│   ├── temp --item <preset> --title ... --bldat ... --amount ... [--attach-dir ...]
│   ├── grono --belnr ... --evi-seq ... --item ... --amount ... --bldat ...
│   ├── approval --grono ... --item ... --attach-dir ...
│   └── full --item ... --title ... --bldat ... --amount ... --attach-dir ...
├── task                                    # high-level composed recipes
│   └── jagi --month YYYYMM --bldat YYYYMMDD --receipt <원>
└── config
    ├── show
    └── init
```

## Quick examples

```sh
# 자기관리비 한 번에 상신 (receipt × 70%, 결재단계 첨부까지 포함)
eac task jagi --month 202605 --bldat 20260503 --receipt 44000

# 진행중 결재 문서 보기
eac doc list

# 회수 + 재상신
eac doc recall FI20260000023921
eac temp cancel-group FI20260000023921
eac task jagi --month 202604 --bldat 20260402 --receipt 44000

# 개인 결재선 확인
eac line list
eac line approvers 0000000002 --grono FI20260000023921

# 업로드만 따로 (임시전표에 첨부 추가)
SEQ=$(eac attach new --prog ea)
eac attach upload "$SEQ" ./receipt.jpg,./extra.pdf

# 서비스 직접 호출 (wrapping 안 된 경우)
eac call ZUNIEFI_4207 --prog DRAFT_0010 --data '{"GRONO":"FI20260000023922"}'
```

## Submit layers (중요)

UniDocu에는 **두 개의 별도 EVI_SEQ 레이어**가 있다:

1. **EA 전표 레이어** (`PROG_LEGACY` = `ZB_0202_001`) — `ZUNIEFI_4006` 저장 시 `EVI_SEQ` 필드로 연결. `ZUNIEFI_4207`의 `URL.fileGroupId`에서 조회됨.
2. **결재문서 레이어** (`PROG_DRAFT` = `DRAFT_0010`) — `ApprovalStep` body의 `EVI_SEQ` 필드로 연결. **이게 있어야 결재문서 리스트에 `WF_ATTACH_FLAG=X` (📎)가 뜬다.** 이 필드 없이 상신하면 결재자 입장에서 "첨부 누락"처럼 보임.

`eac submit full` / `eac task jagi`는 두 레이어 모두에 파일을 올리고 `ApprovalStep`에 결재 EVI_SEQ를 포함해서 상신한다.

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
      "wfLineLin1": "0000000816"
    }
  }
}
```

Item preset을 추가하면 `eac submit full --item <name>`으로 그대로 쓸 수 있다. e.g. 가족식사비/원격근무지원비는 같은 flow, `HKONT`/`EVIKB`/결재선만 바꾸면 됨.

## Development

```sh
bun install
bun run src/index.ts --help
```

릴리즈는 `gh workflow run release.yml`로 트리거. oneup이 version bump + npm/Homebrew publish 자동화.
