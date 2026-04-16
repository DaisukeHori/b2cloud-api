# b2cloud-api

ヤマト運輸「送り状発行システム B2クラウド」を LLM / スクリプトから操作できるようにする **TypeScript API + MCP サーバー**。
伝票作成・印刷・PDF取得・12桁追跡番号取得・削除まで、ブラウザ UI 相当の操作を REST / MCP でカバー。

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FDaisukeHori%2Fb2cloud-api&env=B2_CUSTOMER_CODE,B2_CUSTOMER_PASSWORD,MCP_API_KEY&envDescription=B2クラウドの認証情報とMCPアクセスキー)

---

## 特長

- ✅ **実機検証済み** — Node.js E2E 検証で認証から 12桁追跡番号取得まで約 20 秒で完走
- ✅ **ブラウザ UI と完全互換のプロトコル** — 元 JavaScript (`main-9d4c7b2348.js`) から直接移植した `f2a` / `e2a` / `t2m` / `t2m2` / `replaceControlCode`
- ✅ **JSON デフォルト + msgpack+zlib オプション** — 通常操作は JSON (`$.b2fetch` 互換)、大量一括と DELETE は msgpack+zlib (MPUploader 互換)
- ✅ **Vercel ワンボタンデプロイ** — 環境変数 3 つ入れるだけ
- ✅ **MCP サーバー搭載** — Claude / ChatGPT / 他 LLM から `tools/call` で即利用
- ✅ **CSRF 対策ヘッダを自動付与** — Origin / Referer / X-Requested-With (欠けると 417 になる罠を回避)
- ✅ **自動再ログイン** — Cookie 失効 (401/403) で自動リトライ
- ✅ **プリンタ種別自動切替** — `output_format: "label"` 指定で `general_settings.printer_type` を切替→印刷→復元

---

## クイックスタート

### Vercel ワンボタンデプロイ

上の Deploy with Vercel ボタンから。必要な環境変数 3 つを入力するだけで即稼働します。

### ローカル開発

```bash
git clone https://github.com/DaisukeHori/b2cloud-api.git
cd b2cloud-api
npm install
cp .env.example .env
# .env を編集して B2クラウド認証情報を設定
npm run dev        # vercel dev でローカル起動
npm run typecheck  # 型チェック
npm test           # 単体テスト
```

### 使用例（curl）

```bash
# ログインセッション確立 (Vercel で稼働している想定)
curl -X POST https://your-app.vercel.app/api/b2/login

# 伝票を作成して印刷、PDF と 12桁追跡番号を取得
curl -X POST https://your-app.vercel.app/api/b2/print \
  -H "Content-Type: application/json" \
  -d '{
    "shipments": [{
      "service_type": "0",
      "consignee_name": "テスト太郎",
      "consignee_telephone_display": "03-1234-5678",
      "consignee_zip_code": "100-0001",
      "consignee_address1": "東京都",
      "consignee_address2": "千代田区",
      "consignee_address3": "千代田1-1",
      "item_name1": "サンプル商品"
    }],
    "print_type": "m5"
  }'
# → { "results": [{ "tracking_number": "389711074012", "issue_no": "UMIN...", "pdf_base64": "JVBERi0x..." }] }
```

---

## 環境変数

### 必須

```env
B2_CUSTOMER_CODE=0482540070       # B2クラウド お客様コード（10桁）
B2_CUSTOMER_PASSWORD=xxxxx        # B2クラウドパスワード
MCP_API_KEY=b2mcp-xxxxx           # MCP アクセスキー（自前で命名）
```

### 任意

```env
B2_CUSTOMER_CLS_CODE=             # お客様コード枝番（通常空）
B2_LOGIN_USER_ID=                 # 個人ユーザーID（通常空）
B2_DEFAULT_PRINT_TYPE=m5          # デフォルト用紙（m/m5/0/4/5/7/8/A）

# デフォルトご依頼主情報（毎回の伝票作成で省略可能になる）
B2_DEFAULT_SHIPPER_NAME=株式会社XXX
B2_DEFAULT_SHIPPER_TEL=03-0000-0000
B2_DEFAULT_SHIPPER_ZIP=100-0000
B2_DEFAULT_SHIPPER_ADDR1=東京都
B2_DEFAULT_SHIPPER_ADDR2=千代田区
B2_DEFAULT_SHIPPER_ADDR3=丸の内1-1

# 請求先（initdisplay から取れない場合）
B2_DEFAULT_INVOICE_CODE=0482540070
B2_DEFAULT_INVOICE_CODE_EXT=       # ★空文字が正解
B2_DEFAULT_INVOICE_FREIGHT_NO=01   # ★枝番はここ
```

### ヘッダーオーバーライド

リクエストヘッダーで認証情報を上書き可能（環境変数より優先）:

```
X-B2-Customer-Code: 0482540070
X-B2-Customer-Password: xxxxx
X-B2-Customer-Cls-Code:
X-B2-Login-User-Id:
X-MCP-API-Key: b2mcp-xxxxx
```

---

## 対応サービスタイプ

### Phase 1 (MVP、実機検証済み)

| service_type | 名称 | ラベル印刷 | 備考 |
|:--:|:--|:--:|:--|
| `0` | 発払い（元払い） | ✅ | 最も一般的。専用ラベル `print_type=4` |
| `4` | タイムサービス | ✅ | `delivery_time_zone` は `"0010"`/`"0017"` のみ |
| `5` | 着払い | ❌ | `invoice_code` 不要、ラベル印刷不可 |
| `8` | 宅急便コンパクト | ❌ | 専用BOX使用、ラベル印刷不可 |

### Phase 2

`2` コレクト / `3` DM / `6` 複数口 / `7` ゆうパケット / `9` コンパクトコレクト / `A` ネコポス

---

## REST API エンドポイント一覧

| Method | Path | 用途 |
|:--|:--|:--|
| GET | `/api/health` | ヘルスチェック |
| POST | `/api/b2/login` | ログインしてセッション確立 |
| POST | `/api/b2/check` | checkonly（バリデーションのみ） |
| POST | `/api/b2/save` | check → 保存 |
| POST | `/api/b2/print` | check → 保存 → 印刷 → PDF → 追跡番号取得（フル E2E） |
| GET | `/api/b2/pdf?issue_no=X` | PDF 直接取得（バイナリ） |
| POST | `/api/b2/reprint` | 発行済み伝票の再印刷 |
| GET | `/api/b2/history?search_key4=X` | 履歴検索 |
| GET | `/api/b2/saved?service_type=0` | 保存済み伝票一覧 |
| DELETE | `/api/b2/saved` | 保存済み伝票削除（body に `{ids: []}`） |
| GET | `/api/b2/tracking?search_key4=X` | 追跡情報取得 |
| GET / PUT | `/api/b2/settings` | プリンタ設定取得 / 切替 |

---

## MCP ツール一覧

Claude Code / Cursor / Continue 等の MCP 対応クライアントから、`/mcp` エンドポイントを登録して使えます。

| ツール名 | 説明 |
|:--|:--|
| `create_and_print_shipment` | 伝票作成→印刷→PDF取得→12桁追跡番号取得を一括実行 |
| `validate_shipment` | バリデーションのみ (`checkonly`) |
| `save_shipment` | 伝票保存のみ |
| `print_saved_shipments` | 保存済み伝票を印刷 |
| `search_history` | 発行済み伝票を検索 |
| `get_tracking_info` | 12桁追跡番号で伝票情報取得 |
| `reprint_shipment` | 発行済み伝票を再印刷 |
| `delete_saved_shipments` | 保存済み伝票を削除 |
| `get_account_info` | アカウント情報（請求先・営業所等） |
| `list_saved_shipments` | 保存済み伝票一覧 |
| `get_printer_settings` | プリンタ設定取得 |
| `set_printer_type` | プリンタ種別切替（レーザー/ラベル） |

### MCP クライアント設定例（Claude Desktop）

```json
{
  "mcpServers": {
    "b2cloud": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://your-app.vercel.app/mcp"],
      "env": {
        "X_MCP_API_KEY": "b2mcp-xxxxx"
      }
    }
  }
}
```

---

## プロトコル方針（実機検証済み）

B2クラウドは **2 種の HTTP クライアント**を使い分けています:

| 用途 | プロトコル | 使用箇所 |
|:--|:--|:--|
| 通常 API 操作 | **JSON** (`application/json`) | 伝票 CRUD・履歴・ポーリング・設定 |
| 大量一括 / DELETE | **msgpack + zlib (raw deflate)** | 外部データ一括発行、保存伝票一括削除 |

本ライブラリも同じ方針で実装:

- **JSON デフォルト** — `$.b2fetch` と同じ挙動、小件数では速度差ほぼ無し
- **`useMsgpack: true`** 明示指定で MPUploader 互換パスに切替（5,000 件で JSON の 1.2%、82 倍の圧縮）
- **DELETE は自動で msgpack+zlib 強制** — JSON body では 409 or 実削除されない（4-11）

---

## 実機検証済みの落とし穴

Node.js 実装で**実際に踏んで対処済み**の罠:

1. **CSRF ヘッダ** — Origin / Referer / X-Requested-With 無いと `417 Expectation Failed`（自動付与）
2. **テンプレート URL** — `/tmp/template.dat` (base64, 460行) が正。`/b2/d/_settings/template` (1115行) は別物
3. **`author{}` の子要素はスペース付き** — `" name"/" uri"/" email"` 必須。スペース無しで entry idx が 3 個ズレる
4. **302 リダイレクト** — `redirect: 'manual'` で手動追跡しないと Cookie が途中で失われる
5. **PDF 取得は 2 段階必須** — `checkonly=1` → `fileonly=1`。新規印刷でも `checkonly=1` 無いと 96B HTML エラー
6. **12桁追跡番号は PDF 取得後** — `polling Success` だけでは UMN 内部番号。PDF 取得 1.4〜2.6 秒後に反映
7. **`search_key4` は 16文字以内・英数字のみ** — 17文字や記号で `ES002070` エラー
8. **DELETE は msgpack+zlib 必須** — JSON body では 409 or 実削除されない
9. **`invoice_code_ext` は空文字** — 枝番は `invoice_freight_no` に入れる（誤ると `ES006002`）
10. **タイム便の `delivery_time_zone`** — `"0010"` / `"0017"` のみ。他コードは `ES002038`

すべて [docs/b2cloud-design.md](./docs/b2cloud-design.md)（3,364 行）に網羅。

---

## アーキテクチャ

```
┌──────────────┐     ┌───────────────────┐     ┌─────────────────┐
│  MCP Client   │────▶│  b2cloud-api      │────▶│  B2クラウド       │
│  REST Client  │◀────│  (Vercel)         │◀────│  (ヤマト運輸)     │
└──────────────┘     └───────────────────┘     └─────────────────┘
                            │
                     ┌──────┴──────┐
                     │ SessionStore │ ← Cookie + template キャッシュ
                     └─────────────┘        (Vercel warm invocation 活用)
```

```
src/
├── auth.ts            # 4段階ログイン（bmypageapi → ME0002 → newb2web → template.dat）
├── b2client.ts        # HTTP クライアント（CSRF/retry/reauth/msgpack|JSON 両対応）
├── msgpack.ts         # f2a/e2a/t2m/t2m2/replaceControlCode（元JS 移植）
├── shipment.ts        # 伝票 CRUD（check/save/list/search/delete）
├── print.ts           # 印刷/PDF/追跡番号取得（createAndPrint フル E2E）
├── createAndPrint.ts  # 高レベル API の公開エントリ
├── settings.ts        # general_settings read-modify-write、printWithFormat
├── session-store.ts   # プロセスメモリキャッシュ
├── validation.ts      # Zod スキーマ / inputToShipment
├── mcp-tools.ts       # MCP ツール 12 個
├── types.ts           # 全型定義
└── utils.ts

api/
├── _lib.ts            # Vercel 共通ヘルパー（CORS/セッション/エラー）
├── health.ts
├── mcp.ts             # POST /api/mcp (JSON-RPC over HTTP)
└── b2/
    ├── login.ts  check.ts  save.ts  print.ts
    ├── pdf.ts    reprint.ts  history.ts
    ├── saved.ts  tracking.ts  settings.ts

tests/                 # 7 ファイル / 65 ケース、ネットワーク非依存
public/
└── index.html         # ランディングページ（Vercel デプロイ先のトップ）
```

---

## ライセンス

Apache 2.0

## 参考資料

- 設計書: [docs/b2cloud-design.md](./docs/b2cloud-design.md) (3,364 行、Node.js E2E 検証済)
- 元 Python 実装: [interman/b2cloud](https://github.com/interman/b2cloud)
- B2クラウド UI: https://newb2web.kuronekoyamato.co.jp/
- 元 JavaScript（ヤマト運輸保有、参考資料として [reference/original-js/](./reference/original-js/)、再配布不可）
