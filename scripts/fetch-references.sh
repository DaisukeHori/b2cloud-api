#!/usr/bin/env bash
# B2クラウドの元JS 3本を references/ に取得するスクリプト
# Usage: bash scripts/fetch-references.sh

set -e

cd "$(dirname "$0")/.."
mkdir -p references

echo "📥 B2クラウドの元JS 3本を取得中..."

# ファイル名のハッシュは B2クラウド側のデプロイで変わる可能性あり
# 最新版を確認: https://newb2web.kuronekoyamato.co.jp/main_menu.html で開発者ツール → Network
MAIN_JS="main-9d4c7b2348.js"
VDR_JS="vdr-3ee93e23a5.js"
VDR2_JS="vdr2-3010403877.js"

BASE_URL="https://newb2web.kuronekoyamato.co.jp/scripts"

for f in "$MAIN_JS" "$VDR_JS" "$VDR2_JS"; do
  echo "  - $f"
  if ! curl -sSfL "$BASE_URL/$f" -o "references/$f"; then
    echo "  ⚠️  $f の取得失敗 — ファイル名のハッシュが変わった可能性あり"
    echo "      ブラウザで最新のファイル名を確認してください"
    exit 1
  fi
done

echo ""
echo "✅ 取得完了:"
ls -la references/*.js
echo ""
echo "📖 役割と使い方は references/README.md 参照"
