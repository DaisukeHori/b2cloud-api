/**
 * Vercel Serverless Functions 用共通ヘルパー
 *
 * ★設計書 8章 参照★
 *
 * - セッション取得（環境変数 + ヘッダーオーバーライド）
 * - JSON レスポンス組立
 * - エラーハンドリング
 * - CORS プリフライト対応
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { B2CloudError, B2ValidationError } from '../src/b2client';
import {
  getOrCreateSession,
  resolveLoginConfig,
} from '../src/session-store';
import type { B2Session } from '../src/types';

// ============================================================
// CORS
// ============================================================

/**
 * CORS プリフライト対応。true を返した場合は呼び出し元で return すべき。
 */
export function handleCors(req: VercelRequest, res: VercelResponse): boolean {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-B2-Customer-Code, X-B2-Customer-Password, X-B2-Customer-Cls-Code, X-B2-Login-User-Id, X-MCP-API-Key'
  );
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

// ============================================================
// セッション取得
// ============================================================

/**
 * ヘッダー / 環境変数からセッションを取得
 */
export async function getSessionFromRequest(
  req: VercelRequest
): Promise<B2Session> {
  const config = resolveLoginConfig(req.headers as any);
  return getOrCreateSession(config);
}

// ============================================================
// エラー→HTTP 変換
// ============================================================

/**
 * エラーを HTTP レスポンスに変換
 */
export function sendError(res: VercelResponse, err: unknown): void {
  if (err instanceof B2ValidationError) {
    res.status(400).json({
      error: 'ValidationError',
      message: err.message,
      errors: err.errors,
    });
    return;
  }
  if (err instanceof B2CloudError) {
    res.status(err.statusCode).json({
      error: 'B2CloudError',
      message: err.message,
      statusCode: err.statusCode,
    });
    return;
  }
  if (err instanceof Error) {
    res.status(500).json({
      error: err.name,
      message: err.message,
    });
    return;
  }
  res.status(500).json({ error: 'InternalError', message: String(err) });
}

// ============================================================
// メソッドチェック
// ============================================================

/**
 * 許可メソッド以外は 405
 */
export function checkMethod(
  req: VercelRequest,
  res: VercelResponse,
  allowed: string[]
): boolean {
  if (!req.method || !allowed.includes(req.method)) {
    res.setHeader('Allow', allowed.join(', '));
    res.status(405).json({ error: 'MethodNotAllowed', allowed });
    return false;
  }
  return true;
}

// ============================================================
// body 取得（Vercel 自動パース）
// ============================================================

/**
 * req.body を object として取得（Vercel は自動で JSON.parse してくれる）
 */
export function getBody(req: VercelRequest): any {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return req.body;
    }
  }
  return req.body ?? {};
}
