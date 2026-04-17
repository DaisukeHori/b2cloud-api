# Express + Swagger 移行 設計書・作業手順書

**対象リポジトリ**: `DaisukeHori/b2cloud-api`
**作成日**: 2026-04-17
**前提**: MCP SDK 移行（完了済み、sha 7d8de3b）

---

## 1. 目的

Vercel ファイルベースルーティング（個別 Serverless Functions）を **Express Router** に統合し、
以下を実現する。

| 目的 | 現状の問題 |
|---|---|
| **ミドルウェア一元化** | CORS / API キー / セッション作成を13ファイルに手書きで繰り返している |
| **Swagger 自動生成** | API ドキュメントがなく、LP の静的ページで手書き管理 |
| **エンドポイント追加の簡素化** | 新規追加のたびにボイラープレート10行をコピペ |
| **メソッドルーティング** | `checkMethod(req, res, ['GET', 'PUT'])` を手書き → `router.get()` / `router.put()` で自然に分離 |
| **エラーハンドリング統一** | 各ハンドラに try/catch を手書き → Express error middleware で一括処理 |
| **ローカル E2E テスト** | supertest で Express app を直接テスト可能（Vercel デプロイ不要） |

---

## 2. アーキテクチャ設計

### 2.1 現在のファイル構造（Vercel ファイルベース）

```
api/
├── _lib.ts          (209行)  共通関数（7関数）
├── health.ts         (22行)  GET /api/health
├── mcp.ts            (56行)  POST /api/mcp（MCP SDK transport）
└── b2/
    ├── check.ts      (72行)  POST /api/b2/check
    ├── download.ts   (57行)  GET  /api/b2/download
    ├── history.ts    (73行)  GET  /api/b2/history
    ├── login.ts      (46行)  POST /api/b2/login
    ├── pdf.ts        (54行)  GET  /api/b2/pdf
    ├── print.ts      (90行)  POST /api/b2/print
    ├── reprint.ts    (79行)  POST /api/b2/reprint
    ├── save.ts       (61行)  POST /api/b2/save
    ├── saved.ts      (84行)  GET+DELETE /api/b2/saved
    ├── settings.ts   (61行)  GET+PUT /api/b2/settings
    └── tracking.ts   (71行)  GET  /api/b2/tracking
合計: 1,035行（14ファイル）
```

各ファイルのボイラープレート（6行/ファイル）:
```typescript
if (handleCors(req, res)) return;
if (requireApiKey(req, res)) return;
if (!checkMethod(req, res, ['POST'])) return;
const session = await getSessionFromRequest(req);
try { ... } catch (e) { sendError(res, e); }
```

### 2.2 移行後のファイル構造（Express Router）

```
api/
└── index.ts          (~30行)  Express app を export default（Vercel エントリポイント）

src/
├── app.ts            (~50行)  Express app 定義 + ミドルウェア + ルーター統合
├── middleware/
│   ├── cors.ts       (~15行)  CORS ミドルウェア
│   ├── api-key.ts    (~30行)  API キー認証ミドルウェア
│   ├── session.ts    (~25行)  B2 セッション自動作成ミドルウェア
│   └── error.ts      (~20行)  エラーハンドリングミドルウェア
├── routes/
│   ├── health.ts     (~10行)  GET /api/health
│   ├── mcp.ts        (~40行)  POST /api/mcp（MCP SDK transport）
│   └── b2.ts         (~200行) B2 全エンドポイント（router.get/post/put/delete）
├── server.ts                  （既存・変更なし）MCP サーバー定義
├── auth.ts                    （既存・変更なし）
├── b2client.ts                （既存・変更なし）
├── print.ts                   （既存・変更なし）
├── ... 他の src/ ファイル      （既存・変更なし）
└── swagger.ts        (~40行)  swagger-jsdoc 設定 + Swagger UI マウント
```

### 2.3 Vercel との互換性

Vercel は `api/index.ts` に `export default` された Express app を
単一 Serverless Function として動かす（公式サポート）:

```typescript
// api/index.ts
import app from '../src/app';
export default app;
```

```json
// vercel.json
{
  "version": 2,
  "rewrites": [{ "source": "/(.*)", "destination": "/api" }],
  "functions": { "api/index.ts": { "maxDuration": 60 } }
}
```

**重要**: `express.static()` は Vercel では無効。静的ファイルは `public/` ディレクトリに配置。
LP は引き続き GitHub Pages でホスト（現行通り）。

---

## 3. ミドルウェア設計

### 3.1 ミドルウェアスタック（適用順）

```
全リクエスト
  ├── cors middleware          ← 全ルートに適用
  ├── express.json()           ← JSON body パース（getBody() の代替）
  │
  ├── GET  /api/health         ← 認証不要
  ├── GET  /api/docs           ← Swagger UI（認証不要）
  ├── GET  /api/b2/download    ← 署名認証（API キー不要）+ session middleware 個別適用
  │                              ※ apiKey middleware の前にマウントし、session だけ個別適用
  │
  ├── apiKey middleware         ← 以下のルートに適用
  │   └── POST /api/mcp        ← MCP SDK transport（セッション不要、ツール内で自前ログイン）
  │
  ├── apiKey middleware + session middleware  ← 以下のルートに適用
  │   ├── POST   /api/b2/print
  │   ├── POST   /api/b2/check
  │   ├── POST   /api/b2/login
  │   ├── POST   /api/b2/save
  │   ├── POST   /api/b2/reprint
  │   ├── GET    /api/b2/history
  │   ├── GET    /api/b2/tracking
  │   ├── GET    /api/b2/pdf
  │   ├── GET    /api/b2/saved
  │   ├── DELETE /api/b2/saved
  │   ├── GET    /api/b2/settings
  │   └── PUT    /api/b2/settings
  │
  └── error middleware          ← 全ルートのエラーを一括処理
```

**重要: download.ts の特殊扱い**

`/api/b2/download` は署名付き URL（HMAC-SHA256）で認証するため、
API キーチェックを通さない。しかし B2 への reprint フローのために
セッションは必要。Express では以下のように実装する:

```typescript
// download だけ apiKey middleware の前にマウントし、session は個別適用
app.get('/api/b2/download', sessionMiddleware, downloadHandler);

// 他の /api/b2/* ルートは apiKey + session の両方を適用
app.use('/api/b2', apiKeyMiddleware, sessionMiddleware, b2Router);
```

### 3.2 各ミドルウェアの仕様

#### cors.ts
```typescript
// 現在の handleCors() と同等
import cors from 'cors';
export const corsMiddleware = cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 'Authorization',
    'X-B2-Customer-Code', 'X-B2-Customer-Password',
    'X-B2-Customer-Cls-Code', 'X-B2-Login-User-Id',
    'X-MCP-API-Key',
  ],
});
```

#### api-key.ts
```typescript
// 現在の checkApiKey() / requireApiKey() と同等
// B2 認証情報が env にある場合のみ API キーを要求
export function apiKeyMiddleware(req, res, next) {
  if (!hasB2EnvCredentials()) return next(); // env になければ認証不要
  if (checkApiKey(req)) return next();
  res.status(401).json({ error: 'Unauthorized', message: '...' });
}
```

#### session.ts
```typescript
// 現在の getSessionFromRequest() と同等
// req.session に B2Session を注入
export async function sessionMiddleware(req, res, next) {
  try {
    req.session = await login(resolveLoginConfig(req));
    next();
  } catch (e) { next(e); }
}
```

#### error.ts
```typescript
// 現在の sendError() と同等
// Express の 4引数ミドルウェア（エラーハンドラ）
export function errorMiddleware(err, req, res, next) {
  // B2ValidationError, ZodError, etc. を適切に変換
  const status = err.status || 500;
  res.status(status).json({ error: err.name, message: err.message });
}
```

### 3.3 ルートごとの認証パターン

| ルート | API キー | セッション | 備考 |
|---|---|---|---|
| `GET /api/health` | 不要 | 不要 | ヘルスチェック |
| `GET /api/docs` | 不要 | 不要 | Swagger UI |
| `GET /api/b2/download` | **不要**（署名で認証） | **要** | HMAC-SHA256 署名付き URL。apiKey middleware の前にマウント |
| `POST /api/mcp` | **要** | **不要** | MCP SDK transport（ツール内で自前ログイン） |
| `POST /api/b2/login` | 要 | 要 | 接続テスト（セッション情報をレスポンスとして返す） |
| `POST /api/b2/print` | 要 | 要 | 送り状発行（フル E2E） |
| `POST /api/b2/check` | 要 | 要 | バリデーションのみ |
| `POST /api/b2/save` | 要 | 要 | 保存のみ |
| `POST /api/b2/reprint` | 要 | 要 | 再印刷 |
| `GET /api/b2/history` | 要 | 要 | 発行済み検索 |
| `GET /api/b2/tracking` | 要 | 要 | 追跡情報 |
| `GET /api/b2/pdf` | 要 | 要 | issue_no で PDF 取得（旧方式） |
| `GET /api/b2/saved` | 要 | 要 | 保存済み伝票一覧 |
| `DELETE /api/b2/saved` | 要 | 要 | 保存済み伝票削除 |
| `GET /api/b2/settings` | 要 | 要 | プリンタ設定取得 |
| `PUT /api/b2/settings` | 要 | 要 | プリンタ種別切替 |

---

## 4. ルーター設計

### 4.1 routes/b2.ts（全 B2 エンドポイント統合）

```typescript
import { Router } from 'express';
const router = Router();

// 現在の api/b2/ の 11 ファイルを統合
// ボイラープレート（CORS/APIキー/セッション/try-catch）は
// ミドルウェアで処理済みなので、ビジネスロジックだけ書く

/**
 * @openapi
 * /api/b2/print:
 *   post:
 *     summary: 送り状発行（フル E2E）
 *     tags: [B2 送り状]
 *     ...
 */
router.post('/print', async (req, res, next) => {
  try {
    const input = bodySchema.parse(req.body);  // getBody(req) → req.body
    // ... 既存のビジネスロジックをそのまま移植 ...
    res.json({ results });
  } catch (e) { next(e); }  // error middleware に委譲
});

// GET+DELETE の複合ルート → router.get() と router.delete() に分離
router.get('/saved', async (req, res, next) => { ... });
router.delete('/saved', async (req, res, next) => { ... });

router.get('/settings', async (req, res, next) => { ... });
router.put('/settings', async (req, res, next) => { ... });

export default router;
```

### 4.2 各エンドポイントの変換パターン

```typescript
// ===== BEFORE（Vercel Serverless） =====
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleCors, checkMethod, requireApiKey, getSessionFromRequest, sendError, getBody } from '../_lib';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;          // ← cors middleware で代替
  if (requireApiKey(req, res)) return;        // ← apiKey middleware で代替
  if (!checkMethod(req, res, ['POST'])) return; // ← router.post() で代替
  try {
    const session = await getSessionFromRequest(req); // ← session middleware で代替
    const input = bodySchema.parse(getBody(req));     // ← req.body で代替
    // ... ビジネスロジック ...
    res.status(200).json({ results });
  } catch (e) {
    sendError(res, e);                                // ← error middleware で代替
  }
}

// ===== AFTER（Express Router） =====
router.post('/print', async (req, res, next) => {
  try {
    const input = bodySchema.parse(req.body);   // ← express.json() が自動パース
    const session = (req as any).session;        // ← session middleware が注入済み
    // ... ビジネスロジック（まったく同じ） ...
    res.json({ results });
  } catch (e) { next(e); }                      // ← error middleware に委譲
});
```

### 4.3 req.query の互換性

Vercel の `req.query` と Express の `req.query` はほぼ同じ型（`Record<string, string | string[]>`）。
現在のコードは `typeof req.query.xxx === 'string'` でガードしているため、**修正不要**。

### 4.4 res の互換性

`res.status().json()`, `res.setHeader()`, `res.send()` は Vercel と Express で**完全互換**。
**修正不要**。

---

## 5. Swagger 設計

### 5.1 ライブラリ

| パッケージ | 用途 |
|---|---|
| `swagger-jsdoc` | JSDoc コメントから OpenAPI spec を自動生成 |
| ~~`swagger-ui-express`~~ | ~~OpenAPI spec を Swagger UI で表示~~ → **実装時に不採用**（後述 §10 参照） |

> **実装時の変更**: Vercel は `express.static()` を無視するため `swagger-ui-express` の
> `swaggerUi.serve` が動作しない。代わりに CDN（cdnjs.cloudflare.com）から CSS/JS を
> 読み込むカスタム HTML を `src/swagger.ts` で生成する方式に変更。

### 5.2 JSDoc アノテーション例

```typescript
/**
 * @openapi
 * /api/b2/print:
 *   post:
 *     summary: 送り状発行（フル E2E）
 *     description: check→保存→印刷→PDF取得→追跡番号取得を一括実行
 *     tags: [B2 送り状]
 *     security:
 *       - ApiKeyQuery: []
 *       - ApiKeyHeader: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PrintRequest'
 *     responses:
 *       200:
 *         description: 成功
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PrintResponse'
 *       401:
 *         description: API キー不正
 */
router.post('/print', async (req, res, next) => { ... });
```

### 5.3 Swagger UI エンドポイント

- **URL**: `GET /api/docs`
- **認証**: 不要（ドキュメント閲覧は誰でも可能）
- **CSS**: Vercel は npm パッケージの CSS を serve できないため、CDN から読み込み:
  ```typescript
  const options = {
    customCssUrl: 'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.18.2/swagger-ui.css'
  };
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec, options));
  ```

---

## 6. 影響範囲

### 6.1 変更するファイル

| ファイル | 行数 | 変更内容 |
|---|---|---|
| `api/index.ts` | **新規 ~5行** | Express app を import + export default |
| `src/app.ts` | **新規 ~50行** | Express app 定義 + ミドルウェア + ルーター |
| `src/middleware/cors.ts` | **新規 ~15行** | CORS |
| `src/middleware/api-key.ts` | **新規 ~30行** | API キー認証 |
| `src/middleware/session.ts` | **新規 ~25行** | B2 セッション注入 |
| `src/middleware/error.ts` | **新規 ~20行** | エラーハンドリング |
| `src/routes/health.ts` | **新規 ~10行** | ヘルスチェック |
| `src/routes/mcp.ts` | **新規 ~40行** | MCP SDK transport（api/mcp.ts から移植） |
| `src/routes/b2.ts` | **新規 ~200行** | 全 B2 エンドポイント（11ファイル統合） |
| `src/swagger.ts` | **新規 ~40行** | swagger-jsdoc + Swagger UI |
| `vercel.json` | **書き換え** | rewrites を `/(.*) → /api` に変更 |
| `package.json` | **追加** | `swagger-jsdoc`, `swagger-ui-express` |

### 6.2 削除するファイル

| ファイル | 理由 |
|---|---|
| `api/_lib.ts` (209行) | middleware/ に分割して代替 |
| `api/health.ts` (22行) | routes/health.ts に移植 |
| `api/mcp.ts` (56行) | routes/mcp.ts に移植 |
| `api/b2/*.ts` (11ファイル, 826行) | routes/b2.ts に統合 |

### 6.3 変更しないファイル

| 範囲 | 行数 | 理由 |
|---|---|---|
| `src/auth.ts` | 501行 | ビジネスロジック |
| `src/b2client.ts` | 482行 | ビジネスロジック |
| `src/print.ts` | 457行 | ビジネスロジック |
| `src/validation.ts` | 387行 | バリデーション |
| `src/shipment.ts` | 258行 | ビジネスロジック |
| `src/settings.ts` | 264行 | ビジネスロジック |
| `src/msgpack.ts` | 499行 | ビジネスロジック |
| `src/types.ts` | 605行 | 型定義 |
| `src/server.ts` | 206行 | MCP SDK サーバー定義 |
| `src/mcp-tools.ts` | 758行 | MCP ツールハンドラ |
| `src/signed-url.ts` | 65行 | 署名付き URL |
| `src/utils.ts` | 26行 | ユーティリティ |
| **合計** | **3,544行** | **一行も変更なし** |

---

## 7. 作業手順

### Step 1: 依存関係追加
```bash
npm install swagger-jsdoc swagger-ui-express cors
npm install -D @types/swagger-jsdoc @types/swagger-ui-express @types/cors
```
- `express` と `@types/express` は既にインストール済み

### Step 2: ミドルウェア作成
1. `src/middleware/cors.ts` — `api/_lib.ts` の `handleCors()` を Express cors パッケージに置換
2. `src/middleware/api-key.ts` — `checkApiKey()` / `requireApiKey()` を Express middleware 化
3. `src/middleware/session.ts` — `getSessionFromRequest()` を middleware 化、`req.session` に注入
4. `src/middleware/error.ts` — `sendError()` を Express error middleware 化

### Step 3: ルーター作成
1. `src/routes/health.ts` — `api/health.ts` から移植
2. `src/routes/mcp.ts` — `api/mcp.ts` から移植（SDK transport 部分はそのまま）
3. `src/routes/b2.ts` — `api/b2/*.ts` 11 ファイルを統合
   - 各ハンドラのボイラープレートを除去
   - ビジネスロジックをそのままコピー
   - `getBody(req)` → `req.body` に置換
   - `req.method === 'GET'` の分岐 → `router.get()` / `router.put()` に分離
   - saved.ts: `router.get('/saved', ...)` + `router.delete('/saved', ...)`
   - settings.ts: `router.get('/settings', ...)` + `router.put('/settings', ...)`
   - download.ts: API キー不要（署名で認証）→ apiKey middleware の前にマウント

### Step 4: Swagger 設定
1. `src/swagger.ts` — swagger-jsdoc の設定 + Swagger UI のマウント
2. 各ルートに `@openapi` JSDoc コメントを追加
3. `GET /api/docs` で Swagger UI を表示

### Step 5: Express app 統合
1. `src/app.ts` — Express app を組み立て:
   ```
   corsMiddleware → express.json()
   → healthRouter（認証不要）
   → swagger（認証不要）
   → GET /api/b2/download（署名認証 + session 個別適用、apiKey 不要）
   → POST /api/mcp（apiKey 必要、session 不要）
   → /api/b2/*（apiKey + session 必要）
   → errorMiddleware
   ```
2. `api/index.ts` — `export default app`（Vercel エントリポイント）

### Step 6: vercel.json 更新
```json
{
  "version": 2,
  "rewrites": [{ "source": "/(.*)", "destination": "/api" }],
  "redirects": [
    { "source": "/", "destination": "https://daisukehori.github.io/b2cloud-api/", "permanent": false }
  ],
  "functions": { "api/index.ts": { "maxDuration": 60 } }
}
```
- `rewrites`: 全リクエストを Express app（`api/index.ts`）に集約
- `redirects`: LP へのリダイレクトは Vercel 側で処理（Express を経由しない）
- `functions`: 単一関数に maxDuration 60秒を設定
- `headers`: Express の cors middleware で処理するため削除

### Step 7: テスト
1. `npm test` — 既存 80 テストが全パスすることを確認
2. supertest による Express app のローカル E2E テスト追加
3. `git push` → Vercel デプロイ → 本番 E2E テスト（16 項目）

### Step 8: 旧ファイル削除
1. `api/_lib.ts` 削除
2. `api/health.ts` 削除
3. `api/mcp.ts` 削除（api/index.ts に置き換え）
4. `api/b2/` ディレクトリごと削除

### Step 9: LP / docs 更新
1. `lp/docs.html` の API エンドポイント一覧を確認（URL は変わらないため最小限の修正）
2. Swagger UI への導線を追加（`/api/docs` リンク）

---

## 8. リスクと対策

| リスク | 対策 |
|---|---|
| Vercel で Express が正しく動かない | cloudflare-mcp の Express + Vercel 構成を参考に実装 |
| Express の error middleware でエラーが飲み込まれる | `next(e)` を確実に呼ぶ + Vercel ランタイムログで監視 |
| req.query の型の差異 | `typeof req.query.xxx === 'string'` ガードが既にあるため互換 |
| MCP SDK transport が Express で動かない | cloudflare-mcp で実証済み（同じパターン） |
| Swagger UI の CSS が Vercel で読めない | CDN から読み込み（cdnjs.cloudflare.com） |
| 全エンドポイント一括移行で一時的に壊れる | Step 7 のテストを全通しするまで main にマージしない |

---

## 9. 工数見積もり

| Step | 作業 | 見積もり |
|---|---|---|
| 1 | 依存関係追加 | 5分 |
| 2 | ミドルウェア作成（4ファイル） | 30分 |
| 3 | ルーター作成（3ファイル） | 1時間 |
| 4 | Swagger 設定 + JSDoc | 1時間 |
| 5 | Express app 統合 | 15分 |
| 6 | vercel.json 更新 | 5分 |
| 7 | テスト + デバッグ | 1時間 |
| 8 | 旧ファイル削除 | 5分 |
| 9 | LP 更新 | 15分 |
| **合計** | | **約4時間** |

---

## 10. 実装結果（2026-04-17 追記）

**ステータス: ✅ 完了** — E2E テスト 16/16 パス、本番デプロイ済み

### 設計からの逸脱

| 設計 | 実装 | 理由 |
|---|---|---|
| `swagger-ui-express` で Swagger UI を表示 | CDN 方式（カスタム HTML）に変更 | Vercel は `express.static()` を無視するため、`swaggerUi.serve` が CSS/JS を serve できない |
| `src/routes/b2.ts` に download を含む | `src/routes/download.ts` を別ファイルに分離 | apiKey middleware の外にマウントする必要があり、ルーターを分離した方が明確 |
| `src/express.d.ts` は設計書に未記載 | 新規追加 | Express の Request 型に `b2session` プロパティを追加するため |
| `package.json` の `build` スクリプト: `tsc -p tsconfig.json` | `echo skipping tsc` に変更 | MCP SDK の型が重くて tsc が OOM（Vercel 8GB でも失敗）。Vercel の自動コンパイルに任せる |
| 工数見積もり: 約4時間 | 実際: 約10分 | ボイラープレート削除 + コピペの機械的作業であり、ファイル数に比例しなかった |

### 実際のファイル構成

```
api/
└── index.ts                   (9行)  Vercel エントリポイント

src/
├── app.ts                     (47行) Express app 定義
├── express.d.ts               (8行)  Request 型拡張
├── middleware/
│   ├── cors.ts                (15行)
│   ├── api-key.ts             (55行)
│   ├── session.ts             (24行)
│   └── error.ts               (53行)
├── routes/
│   ├── health.ts              (18行)
│   ├── mcp.ts                 (53行)
│   ├── b2.ts                  (497行) 全 B2 エンドポイント統合
│   └── download.ts            (68行)  署名認証 PDF ダウンロード
└── swagger.ts                 (72行) swagger-jsdoc + CDN 方式 Swagger UI
```

### Swagger UI

- URL: `GET /api/docs` (https://b2cloud-api.vercel.app/api/docs)
- OpenAPI spec: `GET /api/docs.json`
- CSS/JS: cdnjs.cloudflare.com から CDN ロード（Vercel は express.static() 無効のため）
- swagger-jsdoc の `@openapi` JSDoc コメントから自動生成

### E2E テスト結果（16/16 パス）

1. Health Check → 200
2. REST no key → 401
3. REST with key → 200
4. MCP GET Health → 200
5. MCP no key → 401
6. MCP initialize → 200
7. MCP tools/list = 12
8. MCP get_printer_settings → 200
9. MCP search_history → 200
10. MCP get_tracking_info → 200
11. REST GET /b2/history → 200
12. REST GET /b2/settings → 200
13. Download invalid sig → 403
14. Swagger UI → 200
15. OpenAPI spec JSON → 200
16. LP redirect → 200
