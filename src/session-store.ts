/**
 * セッションキャッシュ（Vercel Serverless / MCP 用）
 *
 * ★設計書 2-2 参照★
 *
 * Vercel の warm invocation 時は同一プロセスがキャッシュされるため、メモリキャッシュで十分。
 * コールドスタート時は再ログインする。
 *
 * キーは「customerCode + clsCode + loginUserId」の組み合わせ。
 * Expire 判定は loginAt からの経過時間（デフォルト 30分）。
 */

import { login, reauthenticate, type LoginConfig } from './auth';
import type { B2Session } from './types';

// ============================================================
// キャッシュストア
// ============================================================

interface CachedSession {
  session: B2Session;
  cachedAt: number;
}

/** プロセスメモリ上のセッションキャッシュ */
const cache = new Map<string, CachedSession>();

/** セッションキャッシュの有効期限（ms）、デフォルト 30分 */
export const SESSION_TTL_MS = 30 * 60 * 1000;

/** セッション再ログインが必要な経過時間（ms）、デフォルト 25分で再ログイン */
export const SESSION_REFRESH_MS = 25 * 60 * 1000;

// ============================================================
// キー生成
// ============================================================

function makeKey(config: LoginConfig): string {
  return [
    config.customerCode,
    config.customerClsCode ?? '',
    config.loginUserId ?? '',
  ].join('|');
}

// ============================================================
// 公開 API
// ============================================================

/**
 * セッションを取得（キャッシュ優先、期限切れ時は再ログイン）
 *
 * @param config ログイン情報
 * @returns 有効なセッション
 */
export async function getOrCreateSession(
  config: LoginConfig
): Promise<B2Session> {
  const key = makeKey(config);
  const cached = cache.get(key);

  if (cached) {
    const age = Date.now() - cached.cachedAt;
    if (age < SESSION_REFRESH_MS) {
      return cached.session;
    }
    // 期限切れ間近 → 再ログイン（セッションタイムアウト回避）
    try {
      await reauthenticate(cached.session);
      cached.cachedAt = Date.now();
      return cached.session;
    } catch {
      // 再ログイン失敗 → 新規ログイン
      cache.delete(key);
    }
  }

  // 新規ログイン
  const session = await login(config);
  cache.set(key, { session, cachedAt: Date.now() });
  return session;
}

/**
 * セッションを強制的に無効化（ログアウト等で利用）
 */
export function invalidateSession(config: LoginConfig): void {
  cache.delete(makeKey(config));
}

/**
 * 全セッションをクリア（テスト用）
 */
export function clearAllSessions(): void {
  cache.clear();
}

/**
 * 指定セッションが古くなった場合に強制的に再ログインする
 *
 * @param session 既存セッション
 */
export async function refreshSessionIfExpired(
  session: B2Session
): Promise<void> {
  const age = Date.now() - session.loginAt.getTime();
  if (age >= SESSION_REFRESH_MS) {
    await reauthenticate(session);
  }
}

// ============================================================
// 環境変数からの LoginConfig 取得
// ============================================================

/**
 * 環境変数 + ヘッダーオーバーライドから LoginConfig を構築
 *
 * ★設計書 7章 参照
 *   X-B2-Customer-Code 等のヘッダがあれば環境変数より優先
 */
export function resolveLoginConfig(headers: Record<string, string | string[] | undefined> = {}): LoginConfig {
  const h = (name: string): string | undefined => {
    const v = headers[name.toLowerCase()];
    if (!v) return undefined;
    return Array.isArray(v) ? v[0] : v;
  };

  const customerCode = h('x-b2-customer-code') ?? process.env.B2_CUSTOMER_CODE;
  const customerPassword =
    h('x-b2-customer-password') ?? process.env.B2_CUSTOMER_PASSWORD;
  const customerClsCode =
    h('x-b2-customer-cls-code') ?? process.env.B2_CUSTOMER_CLS_CODE;
  const loginUserId = h('x-b2-login-user-id') ?? process.env.B2_LOGIN_USER_ID;

  if (!customerCode || !customerPassword) {
    throw new Error(
      'B2 認証情報が設定されていません: B2_CUSTOMER_CODE / B2_CUSTOMER_PASSWORD を設定するか、X-B2-Customer-Code / X-B2-Customer-Password ヘッダを送ってください'
    );
  }

  return {
    customerCode,
    customerPassword,
    customerClsCode: customerClsCode || undefined,
    loginUserId: loginUserId || undefined,
  };
}
