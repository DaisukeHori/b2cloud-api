# 元 B2クラウド JavaScript（参考資料）

このディレクトリは **B2クラウド公式ブラウザUIが実際に配信している JavaScript の原本** です。移植作業の参照のためにリポジトリに含めています。

## ⚠️ 著作権と利用方針

これらのファイルは **ヤマト運輸株式会社** が著作権を保有する配信コードです。本リポジトリに含めているのは以下の目的に限ります:

- ✅ **参考資料**: 実装者（Claude Code 含む）が挙動を確認するため
- ✅ **研究目的**: プロトコル・内部構造の把握
- ❌ **再配布・商用利用はしない**: このリポジトリの再配布時も転載不可
- ❌ **改変版の配布もしない**

原本の入手元:
- `https://newb2web.kuronekoyamato.co.jp/scripts/{filename}.js`
- 2026-04-16 時点のバージョン（ファイル名にハッシュが含まれるためバージョン識別可能）

**ヤマト運輸から削除要請があれば即座に本ディレクトリを削除します。**

---

## 3ファイルの役割

### `vdr-3ee93e23a5.js`（341KB）
- **jQuery 本体** (`!function(t,e){"object"==typeof module...`)
- DOM操作 / Ajax / Deferred / Cookie plugin 等
- 移植では `undici` + `tough-cookie` + async/await で代替

### `vdr2-3010403877.js`（501KB）
- **ライブラリ集** (UMD 形式)
- 主要なもの:
  - `msgpack`（msgpack-javascript 互換）
  - `zlib_asm`（imaya/zlib.js の asm.js ビルド）
  - その他 fancybox, jQuery plugin 数種
- 移植では `@msgpack/msgpack` + `pako` で代替

### `main-9d4c7b2348.js`（415KB）⭐️ 最重要
- **B2クラウド固有のアプリコード**
- この中に設計書 2-3 / 3-4 / 4-7 / 4-11 の核心実装が全て入っている:
  - `f2a(template, data)` — feed → array（行頭）
  - `e2a(mapping, key, entry)` — entry → array（再帰）
  - `t2m(lines)` — template → mapping dict
  - `t2m2(lines, start, path)` — t2m の再帰ヘルパー
  - `FIELD_PATTERN`, `CONTROL_CODE` 定数
  - `replaceControlCode()` エスケープ関数
  - `MPUploader` クラス（post/put/delete、msgpack+zlib パイプライン）
  - `$.b2fetch` (get/post/put/delete/download/csvDownload/base64Download)
  - `URL_GET_TEMPLATE = "/tmp/template.dat"` 定義
  - `___template` グローバル変数と base64Download 経由の初期化
  - `B2VALIDATOR` クライアント側バリデーション
  - エラーコード・メッセージ定数群（SE0001〜SE0137、SI0001〜SI0105 等）
  - 画面遷移・Fancybox UI 制御

---

## 実装で参照する際の具体例

### 例1: `f2a / e2a / t2m` の動作確認

```bash
# main.js 内での定義位置を探す
grep -bn "^function f2a" reference/original-js/main-9d4c7b2348.js
grep -bn "^function e2a" reference/original-js/main-9d4c7b2348.js
grep -bn "^function t2m" reference/original-js/main-9d4c7b2348.js
```

### 例2: `$.b2fetch` の挙動確認

```bash
# $.b2fetch.post が JSON送信していることを確認（設計書 1-3 の根拠）
grep -oE 'b2fetch\.post[^}]+' reference/original-js/main-9d4c7b2348.js | head -1
```

### 例3: `MPUploader` の msgpack+zlib パイプライン

```bash
# MPUploader.post の定義を抜き出す
grep -c "MPUploader" reference/original-js/main-9d4c7b2348.js
python3 -c "
with open('reference/original-js/main-9d4c7b2348.js','rb') as f:
    data = f.read().decode('utf-8', errors='replace')
idx = data.find('MPUploader=function()')
print(data[idx:idx+2500])
"
```

### 例4: `CONTROL_CODE` / `FIELD_PATTERN` 正規表現

```bash
grep -oE 'CONTROL_CODE\s*=\s*\{[^}]+\}' reference/original-js/main-9d4c7b2348.js | head -1
grep -oE 'FIELD_PATTERN\s*=\s*/[^;]+' reference/original-js/main-9d4c7b2348.js | head -1
```

### 例5: エラーコード定数

```bash
grep -oE 'SE0[0-9]{3}="[^"]+"' reference/original-js/main-9d4c7b2348.js | head -20
```

---

## minify されていることへの対処

3ファイルとも minify 済み（改行ほぼなし、変数名1文字）。読むコツ:

```bash
# 特定の関数定義を周辺コンテキスト付きで抽出
python3 << 'EOF'
with open('reference/original-js/main-9d4c7b2348.js', 'rb') as f:
    data = f.read().decode('utf-8', errors='replace')
keyword = 'f2a'  # 調べたい関数名
idx = data.find(f'function {keyword}(')
if idx >= 0:
    print(data[idx:idx+800])
EOF
```

ファイルサイズが大きいので `cat` せず `grep -b` / `grep -c` で位置を特定してから `python3` で該当バイトオフセットを切り出すのが効率的。

---

## このディレクトリを削除する場合

設計書 `docs/b2cloud-design.md` の 2-3-6 に核心関数のコードが既に抜粋されているため、このディレクトリがなくても最小限の実装は可能。削除する場合:

```bash
rm -rf reference/
# CLAUDE.md から reference 参照を削除
# README.md から reference 参照を削除
git add -A && git commit -m "chore: reference/original-js を削除（設計書 2-3-6 に移植済み）"
```

---

**最終取得日:** 2026-04-16
