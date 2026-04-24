#!/usr/bin/env bash
# 자기관리비 상신 — shell 스크립트로 eac primitives를 조합한 예시.
#
# 규칙:
#   - 제목:  "YYYY년 M월 자기관리비"
#   - 환급:  영수증 × 70% (원단위 floor)
#   - 첨부:  ./자기관리비/YYYYMM/ 아래 모든 파일
#
# 사용:
#   ./jagi.sh 202605 20260503 44000
#
# 필요 전제:
#   - eac CLI 설치됨 (npm i -g @zigbang-smarthome/eac-cli)
#   - eac.zigbang.in 에 Chrome 으로 로그인 되어 있음
#   - ~/.config/eac/config.json 에 items.jagi preset 있음 (기본 shipped)

set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "usage: $0 <YYYYMM> <YYYYMMDD-receipt-date> <receipt-won>" >&2
  exit 1
fi

month="$1"; bldat="$2"; receipt="$3"

if [[ ! "$month" =~ ^[0-9]{6}$ ]]; then echo "month must be YYYYMM" >&2; exit 1; fi
if [[ ! "$bldat" =~ ^[0-9]{8}$ ]]; then echo "bldat must be YYYYMMDD" >&2; exit 1; fi

year="${month:0:4}"
mm="${month:4:2}"
m=$((10#$mm))          # strip leading zero
title="${year}년 ${m}월 자기관리비"
amount=$(( receipt * 7 / 10 ))
attach_dir="./자기관리비/${month}"

if [[ ! -d "$attach_dir" ]]; then
  echo "attach dir not found: $attach_dir" >&2
  exit 1
fi

echo "title:  $title"
echo "amount: $receipt × 70% = $amount"
echo "attach: $attach_dir"
echo

exec eac voucher submit \
  --item  jagi \
  --title "$title" \
  --bldat "$bldat" \
  --amount "$amount" \
  --attach-dir "$attach_dir"
