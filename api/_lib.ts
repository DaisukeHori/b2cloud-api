/**
 * Vercel Serverless Functions 用共通ヘルパー
 *
 * ★設計書 8章 参照★
 *
 * - セッション取得（環境変数 + ヘッダーオーバーライド）
 *   ★ステートレス方針: 各リクエストで新規ログインする（設計書 2-2 参照）
 *     - Vercel は本質的にステートレス、複数インスタンスでセッション共有不可
 *     - ログイン所要時間 3-5秒 (E-1検証) は単発印刷の20秒に対し誤差範囲
 *     - Cookie 漏洩リスク・セッションタイムアウト管理が不要
 *     - 大量バッチ処理は別途専用エンドポイントで対応する想定
 * - JSON レスポンス組立
 * - エラーハンドリング
 * - CORS プリフライト対応
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { B2CloudError, B2ValidationError } from '../src/b2client';
import { login, resolveLoginConfig } from '../src/auth';
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
// API キー認証
// ============================================================

/**
 * MCP_API_KEY によるアクセス制御（REST + MCP 共通）
 *
 * - MCP_API_KEY 環境変数が設定されている場合: X-MCP-API-Key ヘッダー必須
 * - MCP_API_KEY 未設定の場合: 認証なし（誰でもアクセス可能）
 *
 * REST API でも MCP でも同じキーを使う。
 */
/**
 * MCP_API_KEY によるアクセス制御（REST + MCP 共通）
 *
 * API キーが必要になる条件:
 *   MCP_API_KEY が設定されている AND B2_CUSTOMER_CODE が設定されている
 *
 * B2_CUSTOMER_CODE が未設定の場合:
 *   → 呼び出し側がヘッダーで B2 認証情報を渡す必要がある（守る情報がない）
 *   → API キーなしで公開しても安全
 *
 * MCP_API_KEY が未設定の場合:
 *   → 認証スキップ（後方互換）
 */
export function checkApiKey(req: VercelRequest): boolean {
  const expected = process.env.MCP_API_KEY;
  if (!expected) return true; // MCP_API_KEY 未設定なら認証スキップ

  // B2 認証情報が env var に入っていなければ、守る情報がないので API キー不要
  if (!process.env.B2_CUSTOMER_CODE) return true;

  // API キーの取得元（優先順位）:
  //   1. クエリパラメータ ?key=xxx  ← claude.ai MCP connector はこの形式
  //   2. ヘッダー X-MCP-API-Key    ← curl / REST クライアント向け
  const queryKey = req.query?.key;
  const qk = Array.isArray(queryKey) ? queryKey[0] : queryKey;
  if (qk === expected) return true;

  const header = req.headers['x-mcp-api-key'];
  const hk = Array.isArray(header) ? header[0] : header;
  if (hk === expected) return true;

  return false;
}

/**
 * API キー認証を実行し、失敗時は 401 を返す。
 * true を返した場合はレスポンス送信済み → 呼び出し元で return すべき。
 */
export function requireApiKey(
  req: VercelRequest,
  res: VercelResponse
): boolean {
  if (!checkApiKey(req)) {
    res.status(401).json({
      error: 'Unauthorized',
      message:
        'Invalid or missing X-MCP-API-Key header. ' +
        'Set MCP_API_KEY environment variable and pass matching key via X-MCP-API-Key header.',
    });
    return true; // 401 送信済み
  }
  return false; // 認証OK、処理続行
}

// ============================================================
// セッション取得（毎回新規ログイン）
// ============================================================

/**
 * リクエストごとに新規ログインしてセッションを返す
 *
 * ★ステートレス方針: キャッシュなし、毎回 4段階ログインを実行（3-5秒）。
 *   設計書 2-2 / E-1 参照。
 *
 *   このシンプルさを選んだ理由:
 *   1. Vercel Serverless はステートレスが前提
 *   2. インスタンス間共有のための永続化（Redis/KV）が不要
 *   3. Cookie 漏洩・セッションタイムアウト管理から解放される
 *   4. ログイン3-5秒は create_and_print 全体の20秒に対し誤差範囲
 *
 *   バッチ処理など複数操作で1セッションを共有したいユースケースは、
 *   将来 `/api/b2/batch` のような専用エンドポイントを追加する想定。
 *   個別エンドポイントは常にステートレスを保つ。
 */
export async function getSessionFromRequest(
  req: VercelRequest
): Promise<B2Session> {
  const config = resolveLoginConfig(req.headers as any);
  return login(config);
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
      _debug_raw: err.rawResponse,
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
