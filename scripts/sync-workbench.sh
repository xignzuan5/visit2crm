#!/usr/bin/env bash
# 把妙搭仓库里「销售画像工作台」的 main 同步到 workbench/。
# 去掉妙搭平台私有文件（.agents/ .claude/ .spark/ .spark_project .env）和应用标识，公开仓库只放业务代码。
# 用法：scripts/sync-workbench.sh <妙搭仓库的本地路径>
set -euo pipefail
src=${1:?用法: scripts/sync-workbench.sh <妙搭仓库的本地路径>}
dst="$(cd "$(dirname "$0")/.." && pwd)/workbench"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git -C "$src" fetch -q origin main
git -C "$src" archive origin/main | tar -x -C "$tmp"
rm -rf "$tmp"/.agents "$tmp"/.claude "$tmp"/.spark "$tmp"/.spark_project "$tmp"/.env "$tmp"/README.md
mkdir -p "$dst"
# README.md / REPORT.md / screenshots/ 是本仓库维护的说明，不随同步覆盖或删除。
rsync -a --delete --exclude /README.md --exclude /REPORT.md --exclude /screenshots/ "$tmp"/ "$dst"/
if grep -rIqE 'app_[0-9a-z]{10,}|feishuapp\.com|miaoda-git' "$dst" --exclude-dir=node_modules; then
  echo "workbench/ 里出现了应用标识或租户地址，先处理再提交：" >&2
  grep -rInE 'app_[0-9a-z]{10,}|feishuapp\.com|miaoda-git' "$dst" --exclude-dir=node_modules >&2
  exit 1
fi
echo "已同步 $(git -C "$src" rev-parse --short origin/main) 到 workbench/"
