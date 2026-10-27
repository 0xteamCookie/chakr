#!/usr/bin/env bash
# Downloads the InjecAgent test cases (Zhan et al., ACL Findings 2024) used by the evaluation.
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)/data"
mkdir -p "$dir"
base=https://raw.githubusercontent.com/uiuc-kang-lab/InjecAgent/main/data
for f in test_cases_dh_base.json test_cases_ds_base.json test_cases_dh_enhanced.json test_cases_ds_enhanced.json tools.json; do
  curl -fsSL -o "$dir/$f" "$base/$f"
  echo "fetched $f"
done
