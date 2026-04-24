# examples

Sample task scripts that compose `eac` primitives into domain-specific workflows.

`eac` is intentionally generic — it only knows about EAC (UniDocu) data and verbs. Policies like "자기관리비는 영수증의 70%" or "제목 규칙은 'YYYY년 M월 ...'" live here, not in the CLI.

Use as-is, or copy to `~/bin/`, `~/.local/bin/`, or your project's `scripts/`.

## Files

- `jagi.sh` — 자기관리비 (receipt × 70%, `자기관리비/YYYYMM/` 폴더)

## Pattern

```sh
# One-shot submit using eac primitives
eac voucher submit \
  --item <preset> \
  --title "..." \
  --bldat YYYYMMDD \
  --amount <won> \
  --attach-dir <dir>
```

The script's job is to compute `title`, `amount`, `attach-dir` from user inputs according to the item's policy (refund rate, naming convention, folder layout).

## Recall + retry

```sh
# Assume the last submission went to GRONO FI20260000023922 but needs changes
eac approval recall       FI20260000023922
eac voucher cancel-group  FI20260000023922

# Fix receipts in ./자기관리비/202604/ then re-run:
./jagi.sh 202604 20260402 44000
```
