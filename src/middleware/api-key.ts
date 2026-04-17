import type { Request, Response, NextFunction } from 'express';

/**
 * API キー認証ミドルウェア
 *
 * API キーが必要になる条件:
 *   MCP_API_KEY が設定されている AND B2_CUSTOMER_CODE が設定されている
 *
 * キー取得元（優先順位）:
 *   1. クエリパラメータ ?key=xxx  ← claude.ai MCP connector
 *   2. ヘッダー X-MCP-API-Key    ← curl / REST クライアント
 */
export function apiKeyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const expected = process.env.MCP_API_KEY;
  if (!expected) return next(); // MCP_API_KEY 未設定なら認証スキップ

  // B2 認証情報が env var に入っていなければ、守る情報がないので API キー不要
  if (!process.env.B2_CUSTOMER_CODE) return next();

  // クエリパラメータ ?key=xxx
  const qk = typeof req.query.key === 'string' ? req.query.key : undefined;
  if (qk === expected) return next();

  // ヘッダー X-MCP-API-Key
  const hk = req.headers['x-mcp-api-key'];
  const headerKey = Array.isArray(hk) ? hk[0] : hk;
  if (headerKey === expected) return next();

  res.status(401).json({
    error: 'Unauthorized',
    message:
      'API key required. Pass via query parameter ?key=xxx or header X-MCP-API-Key.',
  });
}

/**
 * API キーの有効性をチェック（boolean 版、MCP ルート用）
 */
export function checkApiKey(req: Request): boolean {
  const expected = process.env.MCP_API_KEY;
  if (!expected) return true;
  if (!process.env.B2_CUSTOMER_CODE) return true;

  const qk = typeof req.query.key === 'string' ? req.query.key : undefined;
  if (qk === expected) return true;

  const hk = req.headers['x-mcp-api-key'];
  const headerKey = Array.isArray(hk) ? hk[0] : hk;
  if (headerKey === expected) return true;

  return false;
}
