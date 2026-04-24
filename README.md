# eac-cli

Generic CLI for `eac.zigbang.in` (E-Accounting / UniDocu).

Drives the UniDocu named-service API directly over HTTP. No headless browser at runtime — auth is just the `JSESSIONID` cookie pulled out of your local Chrome profile.

The CLI intentionally stays **domain-agnostic**: it only knows about EAC data and verbs. Company-/personal-specific policy (e.g. *"자기관리비 환급은 영수증 × 70%"*) belongs in your own shell scripts or runbooks.

---

## Install

```sh
npm install -g @zigbang-smarthome/eac-cli
brew install zigbang-smarthome/tap/eac-cli
curl -fsSL https://github.com/zigbang-smarthome/eac-cli/releases/latest/download/install.sh | sh
```

Before first use: open Chrome and log in to `https://eac.zigbang.in` at least once so the session cookie lands in your Chrome cookie store. The CLI reads that cookie each run.

## Authentication

- Chrome stores cookies at `~/Library/Application Support/Google/Chrome/Default/Cookies`, AES-128-CBC-encrypted with a key derived from the `"Chrome Safe Storage"` Keychain password.
- On every invocation, `eac` copies the cookie DB to tmpdir, decrypts the `JSESSIONID` for `*.zigbang.in`, and uses it for API calls.
- macOS may prompt for Keychain access the first time (click *Always Allow*).
- There is no `eac login`. If the session expires, log in to eac.zigbang.in in Chrome again and re-run.

---

## Concept model

Before the commands it helps to see the data model the CLI talks to. UniDocu has **two related document spaces** and **two separate attachment layers**.

### 두 문서 공간

| 공간 | 식별자 | UI 메뉴 | Backend service prefix |
|------|--------|---------|------------------------|
| **전표 (FI)** | `BELNR` (SAP 문서번호) | 비용정산 › 개인비용 › EA전표결재 (`UD_0302_000`) | `ZUNIEFI_*` |
| **결재문서 (WF)** | `GRONO` (그룹번호) + `WF_KEY` | 결재함 (`UFL_0401_020` 등) | `ZUNIEWF_*` |

하나의 전표(BELNR)에 결재요청을 걸면 결재문서(GRONO)가 예약돼 전표에 붙는다. 관계는 1:1.

### 두 첨부 레이어 — **결재자 입장에서 달라 보인다**

같은 영수증 PDF를 올리더라도 **어느 레이어에 붙이느냐**가 결재자 UX를 가른다.

1. **전표 레이어** (`voucher attach`) — `ZUNIEFI_4006` 저장 시 함께 연결됨. 세무/회계팀이 전표 상세뷰에서 확인.
2. **결재문서 레이어** (`approval attach`) — `ApprovalStep` body의 `EVI_SEQ` 필드로 전달됨. **이게 있어야 결재함 리스트에서 `📎` 아이콘이 뜬다** (`WF_ATTACH_FLAG = X`). 없으면 결재자 입장에서 "첨부 없는 문서"로 보임.

`voucher create` 는 1번 레이어에, `voucher request-approval` 은 2번 레이어에 각각 올린다. 두 명령 모두 `--attach-dir`를 받아 같은 영수증 폴더를 두 번 올림. (같은 파일의 중복 업로드는 서버 저장소에 별개 기록으로 남는다.)

### 11-step 상세 (참고)

1. `ZUNIEFI_4003` — 기본값 계산 (ZFBDT 등)
2. `ZUNIECM_5030` — 전표 레이어 EVI_SEQ 채번
3. `fineuploader/request.do` — 전표 레이어에 파일 업로드
4. `ZUNIEFI_4006` — 비용항목 저장 (EVI_SEQ 연결)
5. `ZUNIEFI_5000` — SAP posting → BELNR 발급
6. `ZUNIEFI_4203` — GRONO 예약 (아직 상신 아님)
7. `ZUNIECM_5030` — 결재 레이어 EVI_SEQ 채번
8. `fineuploader/request.do` — 결재 레이어에 파일 업로드
9. `ZUNIEWF_2200` — 개인결재선 목록 조회
10. `ZUNIEWF_4101` — 결재자 리스트 조회
11. `ApprovalStep` (targetNamedServiceId `ZUNIEWF_4201`) — 최종 상신

1~5 = `voucher create`, 6~11 = `voucher request-approval`.

---

## Command reference

```
eac
├── voucher            전표 (FI, ZUNIEFI_*)
│   ├── list                       ZUNIEFI_4200
│   ├── show <BELNR|GRONO>         ZUNIEFI_4207
│   ├── create                     전표 작성 (Steps 1-5 → BELNR)
│   ├── request-approval <BELNR>   결재요청 (Steps 6-11 → GRONO + 상신)
│   ├── cancel-group <GRONO>       그룹번호취소 (ZUNIEFI_4202)
│   └── attach new|upload|list     전표 레이어 EVI_SEQ primitive
├── approval           결재문서 (WF, ZUNIEWF_*)
│   ├── list [--box]               ZUNIEWF_4500 (결재함)
│   ├── recall <GRONO>             회수 (ApprovalStep + ZUNIEWF_4320)
│   ├── attach new|upload|list     결재 레이어 EVI_SEQ primitive
│   └── line
│       ├── list                   ZUNIEWF_2200 (개인결재선)
│       └── approvers <SEQ>        ZUNIEWF_4101
├── call <id> --prog [--data]      raw named-service escape hatch
└── config show|init               ~/.config/eac/config.json
```

### `eac voucher`

**`voucher list`** — `ZUNIEFI_4200`. 기본은 현재 월, `BSTAT=V` (임시전표). `--bstat *`로 전체, `--stats`로 미상신/진행중/승인/회수/반려 필터.

**`voucher show <BELNR|GRONO>`** — `ZUNIEFI_4207`. BELNR/GRONO 아무 거나 받아 상세 표시 (BELNR은 서버 3-개월 조회 윈도우 내에서 자동 resolve).

**`voucher create`** — 전표 작성. Steps 1-5. BELNR 반환. 아직 GRONO 없음 (결재 전).
```
--item <name>        Preset name from config.items (e.g. "자기관리비")
--title <text>       전표 제목 (SGTXT)
--bldat <YYYYMMDD>   영수증 날짜
--budat <YYYYMMDD>   전기일자 (default: today)
--amount <won>       금액 (정수)
--attach-dir <path>  첨부 폴더 (optional)
```

**`voucher request-approval <BELNR>`** — 결재요청. Steps 6-11. GRONO 발급 + 실제 상신. `--attach-dir` 필수 (결재 레이어 첨부).

**`voucher cancel-group <GRONO>`** — 그룹번호취소 (`ZUNIEFI_4202`). 회수(`STATS=C`)된 전표에 붙은 GRONO를 풀어준다. 풀린 BELNR은 다시 결재요청 가능.

**`voucher attach {new, upload, list}`** — 전표 레이어 EVI_SEQ 직접 조작 (보통 `create`가 자동 처리하므로 쓸 일 많지 않음).

### `eac approval`

**`approval list [--box progress|approved|rejected|pending]`** — `ZUNIEWF_4500`. 📎 표시로 결재 레이어 첨부 유무 한눈에 보임.

**`approval recall <GRONO>`** — 진행중 결재문서 회수. 내부는 `ApprovalStep` + `targetNamedServiceId=ZUNIEWF_4320` + `APPR_STAT=E`.

**`approval attach {new, upload, list}`** — 결재 레이어 EVI_SEQ 직접 조작 (보통 `request-approval`이 자동 처리).

**`approval line list`** — 개인결재선 목록 (`ZUNIEWF_2200`).  
**`approval line approvers <SEQ> --grono <G>`** — 해당 결재선의 실제 결재자 리스트 (`ZUNIEWF_4101`).

### `eac call`

Wrapping 없는 서비스 직접 호출용 escape hatch.

```sh
eac call ZUNIEFI_4207 --prog DRAFT_0010 --data '{"GRONO":"FI20260000023922"}'
```

### `eac config`

- `config show` — 현재 config JSON 프린트
- `config init` — `~/.config/eac/config.json` 없으면 기본값 생성

---

## Standard flow — 2 steps

eac-cli는 "전표 작성 + 결재요청 한 번에"라는 composite를 **일부러 제공하지 않는다**. 중간에 실패하면 상태(BELNR 발급됐는데 GRONO 없음)가 숨겨져 복구가 어려워지기 때문. 필요하면 shell script로 2 단계를 명시적으로 조합.

```sh
# Step 1: 전표 작성
BELNR=$(eac voucher create \
  --item  "자기관리비" \
  --title "2026년 5월 자기관리비" \
  --bldat 20260503 \
  --amount 30800 \
  --attach-dir ./자기관리비/202605 \
  | awk '/^BELNR/ {print $2}')
echo "BELNR=$BELNR"

# Step 2: 결재요청
eac voucher request-approval "$BELNR" \
  --item  "자기관리비" \
  --title "2026년 5월 자기관리비" \
  --attach-dir ./자기관리비/202605
```

이걸 그대로 월별 task script로 감싸서 `~/bin/` 또는 repo의 `scripts/`에 두면 됨:

```sh
#!/usr/bin/env bash
# scripts/자기관리비-상신.sh
set -euo pipefail
month="$1"; bldat="$2"; receipt="$3"
y="${month:0:4}"; m=$((10#${month:4:2}))
title="${y}년 ${m}월 자기관리비"
amount=$(( receipt * 7 / 10 ))
dir="./자기관리비/${month}"

BELNR=$(eac voucher create --item "자기관리비" --title "$title" \
  --bldat "$bldat" --amount "$amount" --attach-dir "$dir" \
  | awk '/^BELNR/ {print $2}')

eac voucher request-approval "$BELNR" --item "자기관리비" \
  --title "$title" --attach-dir "$dir"
```

## Recovery flows

### 상신 후 실수 발견 → 회수하고 재상신

```sh
# 예: 23922 상신했는데 영수증 잘못 넣었음
eac approval recall       FI20260000023922
eac voucher cancel-group  FI20260000023922

# 이제 BELNR 3200005520 은 "미상신" 상태. 다시 결재요청 가능:
eac voucher request-approval 3200005520 \
  --item  "자기관리비" \
  --title "2026년 5월 자기관리비 (수정)" \
  --attach-dir ./자기관리비/202605
```

### 아이템 자체를 잘못 골랐을 때 (FI_22 → FI_21)

전표(BELNR)는 `HKONT`/`EVIKB` 확정 후 SAP에 posting되므로 item을 바꾸려면 **새 전표 필요**. 기존 것은 회수만 해두고 새로 create:

```sh
# 잘못된 item
eac approval recall       FI20260000023877
eac voucher cancel-group  FI20260000023877
# 기존 BELNR은 방치 (또는 EAC UI에서 임시전표삭제)

# 올바른 item 으로 새로 시작
BELNR=$(eac voucher create --item "자기관리비" ...)
eac voucher request-approval "$BELNR" --item "자기관리비" ...
```

### 조회 / 디버깅

```sh
eac voucher list                 # 내 임시전표
eac voucher list --bstat '*' --stats '*'   # 전체
eac voucher show FI20260000023922
eac approval list                 # 진행중
eac approval list --box rejected  # 반려/회수

# 결재선 구조 확인
eac approval line list
eac approval line approvers 0000000002 --grono FI20260000023922
```

---

## Config

`~/.config/eac/config.json`. 한 번 설정하고 `--item <name>` 으로 재사용.

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
    "자기관리비": {
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

새 item 추가 시 필요한 값:
- `hkont` — G/L 계정 (e.g. `52010177` 판)복리후생비-기타)
- `evikb` — 전표 종류 코드 (e.g. `FI_21` 장려지원금, `FI_22` 일반경비)
- `wfLineSeq` / `wfLineLin1` — 해당 item의 개인결재선 (참고: `eac approval line list`로 확인)

Preset key는 한글 이름(`자기관리비`, `가족식사비`, `원격근무지원비`, …) 사용 권장.

---

## Development

```sh
bun install
bun run src/index.ts --help
```

Release: `gh workflow run release.yml` — oneup가 version bump + npm/Homebrew publish 자동화.

## License

MIT
