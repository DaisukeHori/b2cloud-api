/**
 * B2クラウド HTTPクライアント（msgpack/JSON 両対応）
 *
 * ★実機検証済み（2026-04-16）★
 *
 * - デフォルトは msgpack+zlib（B2クラウド本来のプロトコル）
 * - useJson: true で JSON フォールバック
 * - レスポンスは常に JSON（サーバー側でフォーマット固定）
 *
 * @see docs/verification-results.md §8
 */

import { cookieFetch } from './auth';
import { compressFeed, MSGPACK_HEADERS, JSON_HEADERS } from './msgpack';
import type { B2Session, B2Response, Shipment } from './types';

// ============================================================
// エラークラス
// ============================================================

export class B2CloudError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody?: string
  ) {
    super(message);
    this.name = 'B2CloudError';
  }
}

export class B2ValidationError extends B2CloudError {
  constructor(
    message: string,
    public readonly errors: Array<{
      error_property_name: string;
      error_code: string;
      error_description: string;
    }>
  ) {
    super(message, 400);
    this.name = 'B2ValidationError';
  }
}

export class B2SessionExpiredError extends B2CloudError {
  constructor() {
    super('B2クラウドセッションが切れました。再ログインが必要です。', 401);
    this.name = 'B2SessionExpiredError';
  }
}

// ============================================================
// リクエストオプション
// ============================================================

export interface B2RequestOptions {
  /** JSON送信にフォールバック（デフォルト: false = msgpack+zlib） */
  useJson?: boolean;

  /** 追加のクエリパラメータ */
  query?: Record<string, string>;

  /** 追加のヘッダ */
  headers?: Record<string, string>;

  /** レスポンスをバイナリ（Uint8Array）で取得（PDFなど） */
  binary?: boolean;
}

// ============================================================
// コアリクエスト関数
// ============================================================

/**
 * B2クラウドへの任意のリクエスト
 *
 * - POST/PUT: body があれば msgpack 圧縮または JSON
 * - GET: body なし、URL のみ
 * - レスポンスは常に JSON (バイナリ時は Uint8Array)
 */
export async function b2Request<T = Shipment>(
  session: B2Session,
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
  options: B2RequestOptions = {}
): Promise<B2Response<T> | Uint8Array> {
  const url = buildUrl(session.baseUrl, path, options.query);

  const init: any = {
    method,
    headers: { ...(options.headers ?? {}) },
  };

  // ボディが必要な場合
  if (body !== undefined && (method === 'POST' || method === 'PUT')) {
    if (options.useJson || !session.template) {
      // JSON フォールバック
      init.headers = { ...init.headers, ...JSON_HEADERS };
      init.body = JSON.stringify(body);
    } else {
      // msgpack+zlib（デフォルト）
      init.headers = { ...init.headers, ...MSGPACK_HEADERS };
      init.body = compressFeed(session.template, body);
    }
  }

  // リクエスト実行
  const res = await cookieFetch(url, init, session.cookieJar);

  // セッション切れ判定
  if (res.status === 401 || res.status === 403) {
    throw new B2SessionExpiredError();
  }

  // バイナリレスポンス（PDF等）
  if (options.binary) {
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }

  // JSON レスポンス（エラー時も JSON で返る）
  const text = await res.text();

  // PDF エラー時の HTML レスポンス判定（96B の sys_err.html リダイレクト）
  if (text.startsWith('<html')) {
    throw new B2CloudError(
      `B2クラウドエラー（HTMLレスポンス）: ${text.substring(0, 200)}`,
      res.status,
      text
    );
  }

  let parsed: B2Response<T>;
  try {
    parsed = JSON.parse(text) as B2Response<T>;
  } catch (e) {
    throw new B2CloudError(
      `B2クラウドレスポンスのJSONパースに失敗: ${text.substring(0, 200)}`,
      res.status,
      text
    );
  }

  // feed.title === 'Error' の判定
  if (parsed.feed?.title === 'Error') {
    const errors: any[] = [];
    for (const entry of parsed.feed.entry ?? []) {
      if (entry.error) errors.push(...entry.error);
    }
    throw new B2ValidationError(
      errors.length > 0
        ? `B2クラウドバリデーションエラー: ${errors.map((e) => e.error_description).join(', ')}`
        : 'B2クラウドエラー',
      errors
    );
  }

  return parsed;
}

/**
 * GET リクエスト（JSONレスポンス）
 */
export async function b2Get<T = Shipment>(
  session: B2Session,
  path: string,
  options?: B2RequestOptions
): Promise<B2Response<T>> {
  const res = await b2Request<T>(session, path, 'GET', undefined, options);
  if (res instanceof Uint8Array) {
    throw new Error('Binary response on GET with JSON expected');
  }
  return res;
}

/**
 * GET リクエスト（バイナリレスポンス、PDF用）
 */
export async function b2GetBinary(
  session: B2Session,
  path: string,
  options?: Omit<B2RequestOptions, 'binary'>
): Promise<Uint8Array> {
  const res = await b2Request(session, path, 'GET', undefined, {
    ...options,
    binary: true,
  });
  if (!(res instanceof Uint8Array)) {
    throw new Error('Expected binary response');
  }
  return res;
}

/**
 * POST リクエスト
 */
export async function b2Post<T = Shipment>(
  session: B2Session,
  path: string,
  body: unknown,
  options?: B2RequestOptions
): Promise<B2Response<T>> {
  const res = await b2Request<T>(session, path, 'POST', body, options);
  if (res instanceof Uint8Array) {
    throw new Error('Binary response on POST with JSON expected');
  }
  return res;
}

/**
 * PUT リクエスト
 */
export async function b2Put<T = Shipment>(
  session: B2Session,
  path: string,
  body: unknown,
  options?: B2RequestOptions
): Promise<B2Response<T>> {
  const res = await b2Request<T>(session, path, 'PUT', body, options);
  if (res instanceof Uint8Array) {
    throw new Error('Binary response on PUT with JSON expected');
  }
  return res;
}

// ============================================================
// ヘルパー
// ============================================================

/**
 * URL組み立て
 * path が "?" で始まる場合はクエリ文字列として扱う
 */
function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string>
): string {
  // 正規化: path は / で始まるか確認
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`);

  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

/**
 * PDFバイナリが正常か判定（先頭4バイト = "%PDF"）
 */
export function isValidPdf(buf: Uint8Array): boolean {
  return (
    buf.length > 4 &&
    buf[0] === 0x25 && // %
    buf[1] === 0x50 && // P
    buf[2] === 0x44 && // D
    buf[3] === 0x46 //   F
  );
}

/**
 * 非同期 sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * ユニークキー生成（search_key4 用、半角英数字のみ）
 * 重複しないよう timestamp + random 組み合わせ
 */
export function generateUniqueKey(prefix: string = 'API'): string {
  const ts = Date.now().toString();
  const rand = Math.floor(Math.random() * 1e6)
    .toString()
    .padStart(6, '0');
  // 半角英数字のみで構成
  return `${prefix}${ts}${rand}`.substring(0, 20);
}
