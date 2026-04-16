# B2クラウド 元JS 参考資料

このディレクトリは **B2クラウドのブラウザ向け JavaScript を移植元として参照するためのローカル用作業領域** です。

## ⚠️ 重要

**JSファイル本体はリポジトリに含めません（`.gitignore` で除外）。** ヤマト運輸の著作物のため再配布せず、必要なときに各自の環境で取得してください。

## 3つのJSファイルの役割

B2クラウドのフロントエンドはこの3ファイルで構成されています:

| ファイル | サイズ | 役割 | 参照目的 |
|---------|-------|------|---------|
| `main-9d4c7b2348.js` | ~416KB | **B2クラウドアプリロジック** | `f2a` / `e2a` / `t2m` / `t2m2` / `$.b2fetch` / `MPUploader` / バリデーション / UI全般。**設計書の移植元の主軸** |
| `vdr-3ee93e23a5.js` | ~342KB | jQuery + plugins バンドル | `$.ajax`, `$.cookie`, `$.Deferred` 等の動作確認用 |
| `vdr2-3010403877.js` | ~501KB | **msgpack + zlib_asm バンドル** | `msgpack.encode` / `zlib_asm.compress` の元実装。ワイヤーフォーマット確認用 |

## 取得方法

以下のコマンドで最新版をローカルに取得:

```bash
cd references
curl -s "https://newb2web.kuronekoyamato.co.jp/scripts/main-9d4c7b2348.js" -o main-9d4c7b2348.js
curl -s "https://newb2web.kuronekoyamato.co.jp/scripts/vdr-3ee93e23a5.js" -o vdr-3ee93e23a5.js
curl -s "https://newb2web.kuronekoyamato.co.jp/scripts/vdr2-3010403877.js" -o vdr2-3010403877.js
```

**注:** ファイル名のハッシュ部分（`9d4c7b2348` 等）は B2クラウド側のデプロイで変わる可能性があります。その場合はブラウザで `https://newb2web.kuronekoyamato.co.jp/main_menu.html` を開き、開発者ツールの Network タブから最新の scripts/ 配下ファイル名を確認してください。

## 実装時の使い方

### grep で関数定義を探す
```bash
# f2a の実装を見る
grep -b "function f2a" references/main-9d4c7b2348.js

# b2fetch.post の実装
grep -boE "b2fetch\[.delete.\]" references/main-9d4c7b2348.js

# MPUploader の prototype.post
grep -bE "MPUploader.*prototype\.post" references/main-9d4c7b2348.js
```

### Python で特定オフセットの周辺を読む
```python
with open('references/main-9d4c7b2348.js','rb') as f:
    f.seek(22713)  # grep -b で見つけたオフセット
    print(f.read(500).decode('utf-8', errors='replace'))
```

### 設計書との対応
- **2-3-6** f2a / e2a / t2m / t2m2 の定義 → `main-9d4c7b2348.js` 冒頭
- **2-3-5** msgpack+zlib パイプライン → `main-9d4c7b2348.js` の MPUploader クラス
- **1-3** `$.b2fetch` が JSON、`MPUploader` が msgpack → `main-9d4c7b2348.js` を grep
- **3-4** `URL_GET_TEMPLATE = "/tmp/template.dat"` の定義 → `main-9d4c7b2348.js`

## 著作権について

これらのJSファイルはヤマト運輸（B2クラウド）の著作物です。本プロジェクトは「互換実装を作るための参考」として各自のローカル環境で一時的に保持することを想定しており、**公開リポジトリには含めません**。

実装時は **元JSの挙動を設計書に日本語で記述 → 設計書をもとに TypeScript で独自実装** という流れを守り、元JSの著作物を直接コピーしないでください。
