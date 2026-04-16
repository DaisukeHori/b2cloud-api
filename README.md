# b2cloud-api

ヤマト運輸「送り状発行システム B2クラウド」のTypeScript API / MCPサーバー。
伝票作成・印刷・追跡番号取得・削除をフルカバー。

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FDaisukeHori%2Fb2cloud-api&env=B2_CUSTOMER_CODE,B2_CUSTOMER_PASSWORD,MCP_API_KEY&envDescription=B2クラウドの認証情報とMCPアクセスキー)

## 概要

- **REST API**: `/api/b2/*` から伝票操作
- **MCP Server**: `/api/mcp` から Model Context Protocol 互換ツール群
- **プロトコル**: 通常操作は JSON (B2クラウド元JS `$.b2fetch` 互換)、DELETE と大量一括は msgpack+zlib (MPUploader 互換)。ブラウザの元JSと同一の挙動を再現
- **Vercel ワンボタンデプロイ**: 環境変数設定だけで即利用可能

## 対応サービスタイプ

**Phase 1 (MVP):**
- 発払い (`service_type=0`)
- タイムサービス (`service_type=4`)
- 着払い (`service_type=5`)
- 宅急便コンパクト (`service_type=8`)

**Phase 2:**
- EAZY, コレクト, DM, 複数口, ゆうパケット, コンパクトコレクト, ネコポス

## 環境変数

### 必須
```env
B2_CUSTOMER_CODE=0482540070       # お客様コード
B2_CUSTOMER_PASSWORD=xxxxx        # パスワード
MCP_API_KEY=b2mcp-xxxxx           # MCPアクセスキー
```

### 任意
```env
B2_CUSTOMER_CLS_CODE=             # 枝番
B2_LOGIN_USER_ID=                 # 個人ユーザーID
B2_DEFAULT_PRINT_TYPE=m5          # デフォルト用紙（m/m5/0/4/5/7/8/A）
B2_DEFAULT_SHIPPER_NAME=株式会社XXX
B2_DEFAULT_SHIPPER_TEL=
B2_DEFAULT_SHIPPER_ZIP=
B2_DEFAULT_SHIPPER_ADDR1=
B2_DEFAULT_SHIPPER_ADDR2=
B2_DEFAULT_SHIPPER_ADDR3=
```

ヘッダーオーバーライド対応:
```
X-B2-Customer-Code: {code}
X-B2-Customer-Password: {password}
X-B2-Customer-Cls-Code: {cls_code}
X-B2-Login-User-Id: {user_id}
```

## REST API

```
POST /api/b2/login        # ログインしてセッション確立
POST /api/b2/check        # checkonly（バリデーションのみ）
POST /api/b2/save         # check → save
POST /api/b2/print        # check → save → print → PDF取得 → tracking取得（フルE2E）
GET  /api/b2/pdf?issue_no # PDF直接取得
POST /api/b2/reprint      # 発行済み伝票の再印刷
GET  /api/b2/history      # 履歴検索（tracking_number/search_key4/date range）
GET  /api/b2/saved        # 保存済み伝票一覧
DELETE /api/b2/saved      # 保存済み伝票削除
```

## MCP Tools

```
create_and_print_shipment   # 伝票作成→印刷→PDF取得の一括実行
validate_shipment           # バリデーションのみ
save_shipment               # 伝票を保存のみ
print_saved_shipments       # 保存済みを印刷
search_history              # 発行済み検索
get_tracking_info           # 追跡番号で伝票情報取得
reprint_shipment            # 再印刷
delete_saved_shipments      # 保存済み削除
get_account_info            # アカウント情報（請求先等）
list_saved_shipments        # 保存済み一覧
```

## 開発

設計書は [docs/b2cloud-design.md](./docs/b2cloud-design.md) を参照（3,300行、Node.js E2E実装検証済み、全API挙動が実機確定）。

参考資料として [reference/original-js/](./reference/original-js/) に B2クラウド公式ブラウザUIの元 JavaScript (3ファイル、計1.2MB) を含む。移植作業で挙動確認したい時はここを grep する。著作権はヤマト運輸保有、再配布不可。

### セットアップ

```bash
npm install
cp .env.example .env
# .env にB2クラウド認証情報を設定
npm run dev
```

### デプロイ

GitHub → Vercelで Deploy Button をクリック、環境変数入力のみ。

## ライセンス

Apache 2.0

## リファレンス

- 元Python実装: [interman/b2cloud](https://github.com/interman/b2cloud)（Interman Corporation）
- B2クラウド: https://newb2web.kuronekoyamato.co.jp/
