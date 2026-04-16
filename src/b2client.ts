/**
 * B2クラウド HTTPクライアント（JSONデフォルト / msgpack+zlib オプション）
 *
 * ★実機検証済み（2026-04-16）★ 設計書 4-9 / 4-10 / 4-11 参照
 *
 * 主要な方針:
 *   - デフォルトは JSON（$.b2fetch 互換、設計書 1-3 参照）
 *   - DELETE は msgpack+zlib を自動強制（設計書 4-11、JSON body では 409 or no-op）
 *   - useMsgpack: true 明示指定で POST/PUT も msgpack+zlib 送信可能（大量一括時）
 *   - CSRF ヘッダ（Origin / Referer / X-Requested-With）を自動付与
 *     → 無いと 417 Expectation Failed
 *   - 5xx は指数バックオフでリトライ（最大3回）
 *   - 401/403 は onReauthenticate コールバックで再ログイン → リトライ
 *   - レスポンスは常に JSON（リクエスト形式に関わらず、設計書 2-3-3）
 */

import type { RequestInit } from 'undici';
import { fetch } from 'undici';
import { encode as msgpackEncode } from '@msgpack/msgpack';
import { deflateRaw } from 'pako';
import { f2a } from './msgpack';
import type { B2Session, B2Response, Shipment, ErrorInfo } from './types';

// ============================================================
// 定数
// ============================================================

/** ブラウザ互換 User-Agent（4-9 推奨） */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

/** デフォルト Referer（single_issue_reg.html 互換） */
const DEFAULT_REFERER_PATH = '/single_issue_reg.html';

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
    public readonly errors: ErrorInfo[]
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
  /**
   * msgpack+zlib で送信するか
   * - 未指定: DELETE=true（必須）、POST/PUT=false（JSON デフォルト）
   * - true : MPUploader 互換、大量一括時に使う
   * - false: $.b2fetch 互換、軽量通常操作
   */
  useMsgpack?: boolean;

  /** 5xx リトライ回数（デフォルト: 3） */
  maxRetries?: number;

  /** 401/403 時の自動再ログインコールバック */
  onReauthenticate?: (session: B2Session) => Promise<void>;

  /** 追加のクエリパラメータ */
  query?: Record<string, string>;

  /** 追加のヘッダ（デフォルトに上書き） */
  headers?: Record<string, string>;

  /** レスポンスをバイナリ（Uint8Array）で取得（PDFなど） */
  binary?: boolean;

  /**
   * feed.title === "Error" を例外として投げるか
   * デフォルト true（B2ValidationError スロー）
   * 一部エンドポイント（delete / reprint 等）は Error ではない応答を返すこともあり
   * 呼び出し側で判定したい場合は false にする。
   */
  throwOnFeedError?: boolean;
}

// ============================================================
// ユーティリティ
// ============================================================

/**
 * 非同期 sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 * プロセス内単調増加カウンタ（同ミリ秒内衝突回避用）
 */
let uniqueKeyCounter = 0;

/**
 * ユニークキー生成（search_key4 用、半角英数字のみ、16文字以内）
 * ★設計書 E-5 #16-a: 16文字以内・英数字のみでないと ES002070 エラー
 *
 * 構成（16文字以内）: prefix + タイムスタンプ末尾10桁 + カウンタ3桁
 * 例: "API17763079981000" → "API1776307998100"（16文字に切り詰め）
 */
export function generateUniqueKey(prefix: string = 'API'): string {
  // タイムスタンプの末尾10桁（約 27 時間で1巡するがほぼ単調増加）
  const ts = (Date.now() % 10_000_000_000).toString().padStart(10, '0');
  // プロセス内カウンタ（同ミリ秒内の衝突を確実に回避）
  const counter = (uniqueKeyCounter = (uniqueKeyCounter + 1) % 1000)
    .toString()
    .padStart(3, '0');
  // 半角英数字のみで構成、16文字以内に切り詰め
  return `${prefix}${ts}${counter}`.substring(0, 16);
}

/**
 * URL組み立て
 */
function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string>
): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`);

  if (query) {
    for (const [k, v] of Object.entries(query)) {
      // 空文字キー（?checkonly のように値なし）は append(key, '') で実現
      url.searchParams.append(k, v);
    }
  }
  return url.toString();
}

/**
 * msgpack+zlib 圧縮（f2a → msgpack.encode → raw deflate）
 * ★設計書 2-3-5 参照。template が空の場合は fallback として feed データをそのまま encode
 */
function compressBodyMsgpack(session: B2Session, body: any): Uint8Array {
  if (session.template && session.template.length > 0) {
    const array = f2a(session.template, body);
    const packed = msgpackEncode(array);
    return deflateRaw(packed);
  }
  // template 未取得時のフォールバック（非推奨、動作保証なし）
  const packed = msgpackEncode(body);
  return deflateRaw(packed);
}

/**
 * Cookie jar に Set-Cookie を保存
 */
async function saveSetCookies(
  session: B2Session,
  headers: Headers,
  url: string
): Promise<void> {
  // undici の Headers.getSetCookie() を取得
  const getSetCookie = (headers as any).getSetCookie?.bind(headers);
  const setCookies: string[] = getSetCookie ? getSetCookie() : [];
  for (const sc of setCookies) {
    try {
      await session.cookieJar.setCookie(sc, url);
    } catch {
      // 不正な Cookie は無視（防御的）
    }
  }
}

// ============================================================
// コアリクエスト関数
// ============================================================

/**
 * B2クラウドへの統一リクエスト関数
 *
 * @see 設計書 4-9
 */
export async function b2Request<T = Shipment>(
  session: B2Session,
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
  options: B2RequestOptions = {}
): Promise<B2Response<T> | Uint8Array> {
  const {
    maxRetries = 3,
    onReauthenticate,
    throwOnFeedError = true,
  } = options;

  // ★ DELETE は msgpack+zlib 強制（設計書 4-11、JSON body では 409 or no-op）
  // POST/PUT はデフォルト JSON、useMsgpack: true 明示指定時のみ msgpack
  const useMsgpack = options.useMsgpack ?? method === 'DELETE';

  const url = buildUrl(session.baseUrl, path, options.query);

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Cookie 文字列
      const cookieHeader = await session.cookieJar.getCookieString(url);

      // リクエストヘッダ組立
      const headers: Record<string, string> = {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': UA,
        // ★ CSRF 対策ヘッダ（設計書 4-9、無いと 417 Expectation Failed）
        Origin: session.baseUrl,
        Referer: `${session.baseUrl}${DEFAULT_REFERER_PATH}`,
        'X-Requested-With': 'XMLHttpRequest',
      };
      if (cookieHeader) {
        headers.Cookie = cookieHeader;
      }

      // ユーザー指定のヘッダで上書き
      if (options.headers) {
        Object.assign(headers, options.headers);
      }

      const init: RequestInit = {
        method,
        headers,
        redirect: 'manual',
      };

      // ボディ組立（GET 以外）
      if (body !== undefined && method !== 'GET') {
        if (useMsgpack) {
          // msgpack+zlib パイプライン（MPUploader 互換、設計書 2-3-5）
          const compressed = compressBodyMsgpack(session, body);
          headers['Content-Type'] = 'application/x-msgpack; charset=x-user-defined';
          headers['Content-Encoding'] = 'deflate';
          init.body = compressed;
        } else {
          // JSON パス（$.b2fetch 互換、デフォルト）
          headers['Content-Type'] = 'application/json';
          init.body = JSON.stringify(body);
        }
      }

      // リクエスト実行
      const res = await fetch(url, init);

      // Set-Cookie を jar に保存
      await saveSetCookies(session, res.headers as any, url);

      // 401/403 → 再ログイン試行
      if ((res.status === 401 || res.status === 403) && onReauthenticate && attempt === 0) {
        await onReauthenticate(session);
        continue; // リトライ
      }

      // 5xx → 指数バックオフでリトライ
      if (res.status >= 500 && res.status < 600 && attempt < maxRetries) {
        await sleep(Math.min(1000 * Math.pow(2, attempt), 10000));
        continue;
      }

      // バイナリレスポンス（PDF等）
      if (options.binary) {
        const buf = await res.arrayBuffer();
        if (res.status >= 400) {
          const text = new TextDecoder().decode(new Uint8Array(buf).slice(0, 200));
          throw new B2CloudError(
            `HTTP ${res.status}: ${text.substring(0, 200)}`,
            res.status,
            text
          );
        }
        return new Uint8Array(buf);
      }

      const text = await res.text();

      // HTML エラーレスポンス判定（sys_err.html リダイレクト等）
      if (text.startsWith('<html') || text.startsWith('<!DOCTYPE')) {
        if (res.status === 401 || res.status === 403) {
          throw new B2SessionExpiredError();
        }
        throw new B2CloudError(
          `B2クラウドエラー（HTMLレスポンス）: ${text.substring(0, 200)}`,
          res.status,
          text
        );
      }

      // 空レスポンス（checkonly=1 等）
      if (text.length === 0) {
        if (res.status >= 400) {
          throw new B2CloudError(
            `HTTP ${res.status} (空レスポンス)`,
            res.status
          );
        }
        // 空レスポンスを最小 feed として返す（呼び出し側で判定）
        return { feed: { entry: [] } } as B2Response<T>;
      }

      // JSON パース
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

      // HTTP エラー（4xx 以降、ただし 401/403 は上で処理済）
      if (res.status >= 400) {
        throw new B2CloudError(
          `HTTP ${res.status}: ${text.substring(0, 200)}`,
          res.status,
          text
        );
      }

      // feed.title === 'Error' 判定（設計書 4-2）
      if (throwOnFeedError && parsed.feed?.title === 'Error') {
        const errors: ErrorInfo[] = [];
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
    } catch (e) {
      lastError = e as Error;
      // ネットワーク例外は指数バックオフでリトライ（B2CloudError ではないもの）
      if (
        attempt < maxRetries &&
        !(e instanceof B2CloudError) &&
        !(e instanceof B2ValidationError)
      ) {
        await sleep(Math.min(1000 * Math.pow(2, attempt), 10000));
        continue;
      }
      throw e;
    }
  }

  throw lastError || new Error('b2Request failed');
}

// ============================================================
// 便利ラッパー関数
// ============================================================

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
 * POST リクエスト（デフォルト JSON）
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
 * PUT リクエスト（デフォルト JSON）
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

/**
 * DELETE リクエスト（★自動で msgpack+zlib 強制、設計書 4-11）
 */
export async function b2Delete<T = Shipment>(
  session: B2Session,
  path: string,
  body?: unknown,
  options?: B2RequestOptions
): Promise<B2Response<T>> {
  const res = await b2Request<T>(session, path, 'DELETE', body, {
    ...options,
    // 明示的に false にされない限り msgpack を強制
    useMsgpack: options?.useMsgpack ?? true,
  });
  if (res instanceof Uint8Array) {
    throw new Error('Binary response on DELETE with JSON expected');
  }
  return res;
}
