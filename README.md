# eac-cli

Generic CLI for eac.zigbang.in (E-Accounting / UniDocu).

Authenticates by extracting `JSESSIONID` from the local Chrome cookie store (macOS Keychain-decrypted AES-128-CBC), then drives the UniDocu named-service API directly over plain HTTP. No headless browser at runtime.

The CLI only knows about EAC data and verbs. Domain-specific policies (e.g. "자기관리비는 영수증의 70%") belong in your own task scripts — see [`examples/`](./examples/).

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
│   ├── list                         ZUNIEFI_4200
│   ├── show <BELNR|GRONO>           ZUNIEFI_4207
│   ├── create                       전표 작성 (Steps 1-5 → BELNR)
│   ├── request-approval <BELNR>     결재요청 (Steps 6-11 → GRONO + 상신)
│   ├── submit                       Steps 1-11 한 번에 (create + request-approval)
│   ├── cancel-group <GRONO>         그룹번호취소 (ZUNIEFI_4202)
│   └── attach new|upload|list       전표 레이어 EVI_SEQ
├── approval           결재문서 (WF, ZUNIEWF_*)
│   ├── list [--box]                 ZUNIEWF_4500 결재함
│   ├── recall <GRONO>               회수 (ApprovalStep+ZUNIEWF_4320)
│   ├── attach new|upload|list       결재문서 레이어 EVI_SEQ (WF_ATTACH_FLAG 트리거)
│   └── line
│       ├── list                     ZUNIEWF_2200 개인결재선
│       └── approvers <SEQ>          ZUNIEWF_4101
├── call <id> --prog [--data]        raw named-service escape hatch
└── config show|init
```

## Quick examples

```sh
# 전표 조회
eac voucher list
eac voucher show FI20260000023922
eac voucher show 3200005520            # BELNR 로 resolve (3개월 윈도우)

# 결재문서 조회
eac approval list                       # 진행중
eac approval list --box approved

# 원-샷 상신 (일반적 경로)
eac voucher submit \
  --item jagi \
  --title "2026년 5월 자기관리비" \
  --bldat 20260503 \
  --amount 30800 \
  --attach-dir ./자기관리비/202605

# 회수 + 취소 + 재상신
eac approval recall       FI20260000023922
eac voucher cancel-group  FI20260000023922
eac voucher submit --item jagi --title "..." --bldat ... --amount ... --attach-dir ...

# 결재선 확인
eac approval line list
eac approval line approvers 0000000002 --grono FI20260000023922

# 첨부 primitive
SEQ=$(eac approval attach new)
eac approval attach upload "$SEQ" ./a.jpg,./b.pdf
eac approval attach list "$SEQ"

# Raw service call
eac call ZUNIEFI_4207 --prog DRAFT_0010 --data '{"GRONO":"FI20260000023922"}'
```

## Domain task scripts

eac-cli 자체는 도메인 무관(generic). "자기관리비는 영수증 × 70%" 같은 규칙은 user가 shell script로 wrap.

`examples/jagi.sh` 참고:

```sh
./examples/jagi.sh 202605 20260503 44000
# → title="2026년 5월 자기관리비", amount=30800, attach-dir=./자기관리비/202605
# → eac voucher submit 호출
```

## Two attachment layers (중요)

UniDocu에는 **두 개의 별도 EVI_SEQ 레이어**가 있다:

1. **전표 레이어** (`voucher attach`) — `ZUNIEFI_4006`에 연결. `voucher show`의 `attach EVI_SEQ`에 표시됨.
2. **결재문서 레이어** (`approval attach`) — `ApprovalStep` body의 `EVI_SEQ` 필드로 전달. **이게 있어야 결재함 리스트의 `WF_ATTACH_FLAG=X` (📎)가 뜬다.** 이 필드 없이 상신하면 결재자 입장에서 "첨부 누락"처럼 보임.

`voucher submit` / `voucher request-approval`은 두 레이어 모두에 파일을 올리고 `ApprovalStep`에 결재 EVI_SEQ를 포함해서 상신한다. Primitive 직접 조합할 때만 유의.

## Config (`~/.config/eac/config.json`)

사용자 SAP 필드 + 비용 preset. 한번만 설정하고 `--item <name>`으로 재사용.

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

`items.*`에 preset 추가 후 `eac voucher submit --item <name> ...` 으로 사용.

## Development

```sh
bun install
bun run src/index.ts --help
```

Release: `gh workflow run release.yml`.
