/**
 * Express アプリケーション定義
 *
 * ミドルウェア適用順序（設計書 3.1 参照）:
 *   1. CORS
 *   2. express.json()
 *   3. 認証不要ルート（health, swagger）
 *   4. 署名認証ルート（download — API キー不要、セッション要）
 *   5. API キー必須ルート（MCP — セッション不要）
 *   6. API キー + セッション必須ルート（B2 全エンドポイント）
 *   7. エラーハンドリング
 */

import express from 'express';
import { corsMiddleware } from './middleware/cors';
import { apiKeyMiddleware } from './middleware/api-key';
import { sessionMiddleware } from './middleware/session';
import { errorMiddleware } from './middleware/error';
import healthRouter from './routes/health';
import mcpRouter from './routes/mcp';
import b2Router from './routes/b2';
import downloadRouter from './routes/download';
import { mountSwagger } from './swagger';

const app = express();

// ── 1. 共通ミドルウェア ─────────────────────────────────
app.use(corsMiddleware);
app.use(express.json({ limit: '4mb' }));

// ── 2. 認証不要ルート ───────────────────────────────────
app.use('/api/health', healthRouter);
mountSwagger(app); // GET /api/docs, GET /api/docs.json

// ── 3. 署名認証ルート（API キー不要、セッション要） ─────
app.use('/api/b2/download', sessionMiddleware, downloadRouter);

// ── 4. MCP ルート（API キー要、セッション不要） ─────────
//    MCP は router 内で独自に API キーチェックする
//    （SDK transport が req/res を直接ハンドルするため middleware 方式が使えない）
app.use('/api/mcp', mcpRouter);
app.use('/mcp', mcpRouter); // /mcp → /api/mcp の rewrite 代替

// ── 5. B2 ルート（API キー + セッション必須） ───────────
app.use('/api/b2', apiKeyMiddleware, sessionMiddleware, b2Router);

// ── 6. エラーハンドリング ───────────────────────────────
app.use(errorMiddleware);

export default app;
