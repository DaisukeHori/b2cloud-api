# b2cloud-api

ヤマト運輸「送り状発行システム B2クラウド」を **LLM / スクリプトから操作**できる TypeScript API + MCP サーバー。

**宛先と品名を渡すだけで、数秒後に送り状 PDF と 12桁追跡番号が返ってくる。** 伝票作成・印刷・PDF取得・追跡番号取得・削除まで、ブラウザ UI 相当の操作を REST / MCP でカバー。

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FDaisukeHori%2Fb2cloud-api&env=B2_CUSTOMER_CODE,B2_CUSTOMER_PASSWORD,MCP_API_KEY&envDescription=B2クラウドの認証情報とMCPアクセスキー)

📄 **LP:** https://daisukehori.github.io/b2cloud-api/
🔧 **Swagger UI (API 仕様):** https://b2cloud-api.vercel.app/api/docs/

---

## 30秒で理解する使い方

```bash
# 宛先と品名だけ渡せば、送り状 PDF + 12桁追跡番号が返る
curl -X POST https://your-app.vercel.app/api/b2/print \
  -H "Content-Type: application/json" \
  -d '{
    "shipments": [{
      "service_type": "0",
      "consignee_name": "山田太郎",
      "consignee_telephone_display": "03-1234-5678",
      "consignee_zip_code": "100-0014",
      "consignee_address1": "東京都",
      "consignee_address2": "千代田区",
      "consignee_address3": "永田町1-7-1",
      "item_name1": "化粧品"
    }]
  }'
```

```jsonc
// レスポンス
{
  "results": [{
    "tracking_number": "389717757822",   // ← ヤマト12桁追跡番号
    "issue_no": "UMIN0000023737",
    "pdf_base64": "JVBERi0xLjcN...",     // ← 送り状PDF（約100KB）
    "pdf_size": 104113,
    "polling_attempts": 2,
    "tracking_attempts": 5
  }]
}
```

依頼主（shipper）・請求先（invoice）は環境変数でデフォルト設定済のため、**宛先 + 品名の 8 フィールドだけで送り状が出る。**

---

## 特長

- **実印刷まで実機検証済み** — 追跡番号 `389717757822` で実際にヤマトに伝票が発行されることを確認（2026-04-17）
- **ワンコール完結** — `POST /api/b2/print` 1回で check→save→print→PDF→tracking を自動実行（約12秒）
- **MCP サーバー搭載** — Claude / ChatGPT から「送り状を出して」で即利用。12ツール
- **Vercel ワンボタンデプロイ** — 環境変数 3 つ入れるだけ
- **ブラウザ UI と完全互換のプロトコル** — 元 JavaScript から直接移植した msgpack/JSON 両対応
- **CSRF 対策ヘッダを自動付与** — Origin / Referer / X-Requested-With（欠けると 417 になる罠を自動回避）
- **自動再ログイン** — Cookie 失効 (401/403) で自動リトライ
- **プリンタ種別自動切替** — `output_format: "label"` 指定で printer_type を切替→印刷→復元

---

## 送り状に必要な項目

### 必須項目（8フィールド）

| フィールド | 説明 | 例 | ルール |
|:--|:--|:--|:--|
| `service_type` | 伝票種別 | `"0"` | 下記一覧参照 |
| `consignee_name` | お届け先名 | `"山田太郎"` | 最大全角16文字 |
| `consignee_telephone_display` | お届け先電話 | `"03-1234-5678"` | ハイフン付き |
| `consignee_zip_code` | お届け先郵便番号 | `"100-0014"` | |
| `consignee_address1` | 都道府県 | `"東京都"` | 最大10文字 |
| `consignee_address2` | 市区町村 | `"千代田区"` | 最大24文字 |
| `consignee_address3` | 町・番地 | `"永田町1-7-1"` | 最大32文字 |
| `item_name1` | 品名 | `"化粧品"` | 最大50文字。DM(3)以外は必須 |

### 伝票種別 (`service_type`)

| 値 | 名称 | 追加必須フィールド | ラベル印刷 | 備考 |
|:--:|:--|:--|:--:|:--|
| `0` | **発払い（元払い）** | — | ✅ | **最も一般的。迷ったらこれ** |
| `2` | コレクト（代金引換） | `amount`（税込金額） | ✅ | 専用ラベル `print_type=2` |
| `3` | クロネコゆうメール（DM） | — | ❌ | `item_name1` 不要 |
| `4` | タイムサービス | — | ✅ | `delivery_time_zone` は `"0010"` / `"0017"` のみ |
| `5` | 着払い | — | ❌ | `invoice_code` 不要 |
| `6` | 発払い（複数口） | `closure_key` + `package_qty` | — | 合計2〜99個 |
| `7` | クロネコゆうパケット | — | ✅ | 専用ラベル `print_type=7` |
| `8` | 宅急便コンパクト | — | ❌ | 専用BOX使用 |
| `9` | コンパクトコレクト | `amount` | ❌ | |
| `A` | ネコポス | — | ✅ | 専用ラベル `print_type=A` |

### よく使うオプション

| フィールド | 説明 | デフォルト | 備考 |
|:--|:--|:--|:--|
| `shipment_date` | 出荷日 | 本日 | `"YYYY/MM/DD"` 形式 |
| `consignee_address4` | 建物・部屋番号 | — | 最大32文字 |
| `consignee_department1` | 部署名 | — | 最大50文字 |
| `consignee_title` | 敬称 | `"様"` | `"様"` / `"御中"` / `""` |
| `item_name2` | 品名2 | — | |
| `is_cool` | クール便 | `"0"` | `"0"`=普通 / `"1"`=冷凍 / `"2"`=冷蔵 |
| `package_qty` | 個数 | `"1"` | **文字列**で指定（`"1"`〜`"99"`） |
| `note` | 記事欄 | — | 最大44文字 |
| `handling_information1` | 荷扱い情報1 | — | 例: `"ワレモノ注意"`（最大20文字） |
| `search_key4` | 管理用検索キー | 自動生成 | **半角英数字16文字以内** |
| `amount` | 代引金額 | — | コレクト(2)/コンパクトコレクト(9)で必須。`"1"`〜`"300000"` |

### 配達時間帯 (`delivery_time_zone`)

| コード | 時間帯 | 備考 |
|:--|:--|:--|
| `"0000"` | 指定なし | デフォルト |
| `"0812"` | 午前中 | |
| `"1416"` | 14時〜16時 | |
| `"1618"` | 16時〜18時 | |
| `"1820"` | 18時〜20時 | |
| `"1921"` | 19時〜21時 | |
| `"0010"` | 午前中（タイム専用） | `service_type=4` のみ |
| `"0017"` | 午後（タイム専用） | `service_type=4` のみ |

### 印刷設定（通常は省略でOK）

`print_type` の選択肢: `"m"`=A4マルチ / `"m5"`=A5マルチ（デフォルト） / `"4"`=ラベル発払い / `"2"`=ラベルコレクト / `"7"`=ラベルゆうパケ / `"A"`=ラベルネコポス

`output_format` を指定すると `printer_type` を自動切替: `"a4_multi"` / `"a5_multi"` / `"label"`

> **注意:** ラベル印刷は着払い(5)/コンパクト(8)/DM(3)/コンパクトコレクト(9)では不可

---

## クイックスタート

### Vercel ワンボタンデプロイ

上の **Deploy with Vercel** ボタンから。必要な環境変数 3 つを入力するだけで即稼働。

### ローカル開発

```bash
git clone https://github.com/DaisukeHori/b2cloud-api.git
cd b2cloud-api
npm install
cp .env.example .env   # 認証情報を設定
npm run dev             # vercel dev でローカル起動
npm run typecheck       # 型チェック
npm test                # 単体テスト (80ケース)
```

---

## 環境変数

### 必須（3つだけ）

| 変数 | 説明 | 例 |
|:--|:--|:--|
| `B2_CUSTOMER_CODE` | お客様コード（10桁） | `0482540070` |
| `B2_CUSTOMER_PASSWORD` | パスワード | |
| `MCP_API_KEY` | MCP アクセスキー（自前で命名） | `b2mcp-xxxxx` |

### 任意（デフォルト依頼主・請求先）

```env
B2_DEFAULT_SHIPPER_NAME=株式会社XXX
B2_DEFAULT_SHIPPER_TEL=03-0000-0000
B2_DEFAULT_SHIPPER_ZIP=100-0000
B2_DEFAULT_SHIPPER_ADDR1=東京都
B2_DEFAULT_SHIPPER_ADDR2=千代田区
B2_DEFAULT_SHIPPER_ADDR3=丸の内1-1
B2_DEFAULT_INVOICE_CODE=0482540070
B2_DEFAULT_INVOICE_FREIGHT_NO=01
B2_DEFAULT_PRINT_TYPE=m5
```

---

## 認証

### API キー（`MCP_API_KEY`）

REST API と MCP の両方で共通の API キーを使用。

| 条件 | API キー |
|:--|:--|
| env var に `B2_CUSTOMER_CODE` **あり** | **必須** — 下記いずれかの方法で送る |
| env var に `B2_CUSTOMER_CODE` **なし** | **不要** — 守る情報がないので API キーなしで公開OK |
| env var に `MCP_API_KEY` **なし** | **不要** — 認証自体が無効 |

**API キーの渡し方（どちらでもOK）:**

| 方法 | 形式 | 用途 |
|:--|:--|:--|
| クエリパラメータ | `?key=b2mcp-xxxxx` | **claude.ai MCP connector 用**（推奨） |
| ヘッダー | `X-MCP-API-Key: b2mcp-xxxxx` | curl / REST クライアント用 |

> env var に B2 ログイン情報を入れずにデプロイすれば、API キーなしで誰でも使える公開 API になります。  
> その場合、呼び出し側が毎回ヘッダーで B2 ログイン情報を渡す必要があります。

### B2 ログイン情報の渡し方

B2クラウドのお客様コード・パスワードは **3箇所のどこかに入っていれば動く**。優先順位:

| 優先度 | 場所 | ヘッダー / 変数名 |
|:--:|:--|:--|
| 1（最優先） | **リクエストヘッダー** | `X-B2-Customer-Code` / `X-B2-Customer-Password` |
| 2 | **Vercel 環境変数** | `B2_CUSTOMER_CODE` / `B2_CUSTOMER_PASSWORD` |
| — | どちらもなし | エラー（`B2 認証情報が設定されていません`） |

- 環境変数にデフォルト値を入れておけば、リクエストのたびに送る必要なし
- 環境変数が入っていても、ヘッダーで上書き可能（別アカウントで使いたい場合など）
- 環境変数を空にしてデプロイすれば「持ち込み型」の公開 API になる

### 使用例

```bash
# パターン1: 環境変数に認証情報あり → API キーだけ渡す
curl -X POST https://your-app.vercel.app/api/b2/print \
  -H "X-MCP-API-Key: b2mcp-xxxxx" \
  -H "Content-Type: application/json" \
  -d '{"shipments": [{ ... }]}'

# パターン2: 環境変数なし → B2 認証情報をヘッダーで渡す（API キー不要）
curl -X POST https://your-app.vercel.app/api/b2/print \
  -H "X-B2-Customer-Code: 0482540070" \
  -H "X-B2-Customer-Password: xxxxx" \
  -H "Content-Type: application/json" \
  -d '{"shipments": [{ ... }]}'

# パターン3: 環境変数あり + 別アカウントで上書き
curl -X POST https://your-app.vercel.app/api/b2/print \
  -H "X-MCP-API-Key: b2mcp-xxxxx" \
  -H "X-B2-Customer-Code: 9999999999" \
  -H "X-B2-Customer-Password: other-password" \
  -H "Content-Type: application/json" \
  -d '{"shipments": [{ ... }]}'
```

---

## REST API

12 エンドポイントで B2クラウドの全主要操作をカバー。

| Method | Path | 用途 | 実測時間 |
|:--|:--|:--|:--|
| GET | `/api/health` | ヘルスチェック | 即時 |
| GET | `/api/docs` | **Swagger UI（インタラクティブ API ドキュメント）** | 即時 |
| GET | `/api/docs.json` | OpenAPI spec (JSON) | 即時 |
| POST | `/api/b2/login` | 接続テスト（認証確認） | 4.8秒 |
| POST | `/api/b2/check` | バリデーションのみ | 4.9秒 |
| POST | `/api/b2/save` | check → 保存 | 5.1秒 |
| **POST** | **`/api/b2/print`** | **check→保存→印刷→PDF→追跡番号（フル E2E）** | **12.5秒** |
| GET | `/api/b2/download?tn=X&exp=X&sig=X` | 署名付き PDF ダウンロード（60秒有効） | — |
| GET | `/api/b2/pdf?issue_no=X` | PDF 直接取得（旧方式） | — |
| POST | `/api/b2/reprint` | 発行済み伝票の再印刷 | — |
| GET | `/api/b2/history` | 履歴検索 | 4.8秒 |
| GET | `/api/b2/saved?service_type=0` | 保存済み伝票一覧 | 4.7秒 |
| DELETE | `/api/b2/saved` | 保存済み伝票削除 | 4.1秒 |
| GET | `/api/b2/tracking?tracking_number=X` | 追跡情報取得 | 4.2秒 |
| GET/PUT | `/api/b2/settings` | プリンタ設定取得 / 切替 | 5.0秒 |

> 実測時間は 2026-04-17 の E2E 受け入れテスト結果。ステートレスログイン (3-5秒) を含む。

---

## MCP サーバー

Claude Desktop / Claude Code / Cursor / Continue 等から即利用可能。12ツール。

### claude.ai での設定

Settings → MCP Connectors → Add:
- URL: `https://your-app.vercel.app/api/mcp?key=b2mcp-xxxxx`

### Claude Desktop での設定

```json
{
  "mcpServers": {
    "b2cloud": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://your-app.vercel.app/mcp"],
      "env": { "X_MCP_API_KEY": "b2mcp-xxxxx" }
    }
  }
}
```

### ツール一覧（12ツール）

| ツール名 | 説明 |
|:--|:--|
| **`create_and_print_shipment`** | **伝票作成→印刷→PDF→追跡番号を一括実行** |
| `validate_shipment` | バリデーションのみ |
| `save_shipment` | 伝票保存のみ |
| `print_saved_shipments` | 保存済み伝票を印刷 |
| `search_history` | 発行済み伝票を検索 |
| `get_tracking_info` | 12桁追跡番号で照会 |
| `reprint_shipment` | 発行済み伝票を再印刷 |
| `delete_saved_shipments` | 保存済み伝票を削除 |
| `get_account_info` | アカウント情報取得 |
| `list_saved_shipments` | 保存済み伝票一覧 |
| `get_printer_settings` | プリンタ設定取得 |
| `set_printer_type` | プリンタ種別切替 |

> `create_and_print_shipment` の description に全フィールドのルール・service_type 一覧・配達時間帯コードが埋め込まれており、LLM が自力で正しいリクエストを構築できます。

---

## 実機で踏み抜いた落とし穴（10個）

Node.js 実装で**実際に踏んで解決済み**の罠。すべて自動回避されます:

1. **CSRF ヘッダ** — Origin / Referer / X-Requested-With 無いと `417 Expectation Failed`
2. **認証は5段階** — bmypage GET → bmypageapi POST → 302追跡(5ホップ) → ME0002(form-urlencoded) → serviceUrl GET(OAuth) → template.dat
3. **ME0002 は form-urlencoded** — jQuery `$.ajax` の `dataType: "json"` はレスポンス型指定であってリクエスト型ではない
4. **302 リダイレクトは手動追跡** — `redirect: 'manual'` + Cookie 保存しないと途中で Cookie が消える
5. **PDF 取得は 2 段階必須** — `checkonly=1` → `fileonly=1`。`checkonly=1` 無しだと 96B HTML エラー
6. **12桁追跡番号は PDF 取得後に出現** — polling Success だけでは UMN 内部番号のまま
7. **`search_key4` は 16文字以内・英数字のみ** — 17文字や記号で `ES002070` エラー
8. **DELETE は msgpack+zlib 必須** — JSON body では 409 or 実削除されない
9. **polling の `feed.title="Error"` は正常中間状態** — `summary="queued"` は処理中、`throwOnFeedError: false` でリトライ
10. **タイム便の `delivery_time_zone`** — `"0010"` / `"0017"` のみ。他コードは `ES002038`

すべて [docs/b2cloud-design.md](./docs/b2cloud-design.md)（3,364 行）に網羅。

---

## 実機 E2E 検証結果（2026-04-17）

| ステップ | 実測値 | 備考 |
|:--|:--|:--|
| 認証（5段階） | 4.8秒 | 設計書の予測 3-5秒と一致 |
| checkonly | 4.9秒 | `error_flg="0"` |
| save | 5.1秒 | `UMN240526638` |
| print issue | — | `UMIN0000023737` |
| polling | 2回 | `feed.title="Success"` |
| PDF取得 | 104KB | `%PDF-1.7` ヘッダ確認 |
| tracking取得 | 5回リトライ | **`389717757822`** |
| **フル E2E 合計** | **12.5秒** | 設計書の予測 ~20秒より高速 |

---

## アーキテクチャ

```
┌──────────────┐     ┌───────────────────┐     ┌─────────────────┐
│  MCP Client   │────▶│  b2cloud-api      │────▶│  B2クラウド       │
│  REST Client  │◀────│  (Vercel)         │◀────│  (ヤマト運輸)     │
└──────────────┘     └───────────────────┘     └─────────────────┘
                       (ステートレス: 各リクエスト毎に新規ログイン)
```

### 認証フロー（5段階、実ブラウザフローを完全模倣）

```
Step 0:   GET  bmypage/index.html           → Cookie 確立
Step 1:   POST bmypageapi/login             → form submit（7フィールド）
Step 1.5: GET  HMPLGI0010JspServlet         → 302追跡（最大5ホップ）
Step 2:   POST bmypage/ME0002.json          → serviceUrl 取得（form-urlencoded）
Step 3:   GET  {serviceUrl}                 → OAuth コード受渡 → newb2web
Step 4:   GET  {baseUrl}/tmp/template.dat   → msgpack テンプレート 460行
```

### ディレクトリ構造

```
src/
├── app.ts             # Express app 定義 + ミドルウェア + ルーター統合
├── middleware/         # Express ミドルウェア
│   ├── cors.ts        #   CORS
│   ├── api-key.ts     #   API キー認証
│   ├── session.ts     #   B2 セッション自動作成
│   └── error.ts       #   エラーハンドリング
├── routes/            # Express ルーター
│   ├── health.ts      #   GET /api/health
│   ├── mcp.ts         #   POST /api/mcp (MCP SDK transport)
│   ├── b2.ts          #   B2 全エンドポイント統合
│   └── download.ts    #   GET /api/b2/download (署名付き PDF)
├── swagger.ts         # swagger-jsdoc + Swagger UI
├── server.ts          # MCP SDK サーバー定義
├── auth.ts            # 5段階ログイン
├── b2client.ts        # HTTP クライアント（CSRF/retry/reauth/msgpack|JSON）
├── msgpack.ts         # f2a/e2a/t2m/t2m2/replaceControlCode（元JS移植）
├── shipment.ts        # 伝票 CRUD（check/save/list/search/delete）
├── print.ts           # 印刷/PDF/追跡番号取得（createAndPrint フル E2E）
├── settings.ts        # general_settings / printWithFormat
├── validation.ts      # Zod スキーマ / inputToShipment
├── mcp-tools.ts       # MCP ツール 12 個（description に全ルール埋込）
├── signed-url.ts      # HMAC-SHA256 署名付きダウンロード URL
├── types.ts           # 型定義
└── utils.ts

api/
└── index.ts           # Vercel エントリポイント（export default app）

tests/                 # 10 ファイル / 80 ケース
lp/                    # LP（GitHub Pages）
├── index.html         # ランディング
├── docs.html          # ドキュメント
└── specs.html         # 送り状仕様詳細
```

---

## ライセンス

Apache 2.0

## 参考資料

- 設計書: [docs/b2cloud-design.md](./docs/b2cloud-design.md) (3,364 行)
- 元 Python 実装: [interman/b2cloud](https://github.com/interman/b2cloud)
- B2クラウド UI: https://newb2web.kuronekoyamato.co.jp/
