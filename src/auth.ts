/**
 * B2クラウド 認証・セッション管理
 *
 * ★実機検証ベース（2026-04-16）★
 *
 * ログインフロー（4段階）:
 *   1. POST https://bmypageapi.kuronekoyamato.co.jp/bmypageapi/login
 *      (ヤマトビジネスメンバーズへの form POST)
 *
 *   2. POST https://bmypage.kuronekoyamato.co.jp/bmypage/ME0002.json
 *      (serviceUrl を動的取得) ※Python版はURLハードコードで誤り
 *
 *   3. GET {serviceUrl} → newb2web.kuronekoyamato.co.jp にリダイレクト
 *      (B2クラウドのセッションCookie確立)
 *
 *   4. GET {baseUrl}/b2/d/_settings/template
 *      (msgpack用テンプレート1115行を取得、キャッシュ)
 *
 * ★Cookie が 3ドメインにまたがるため tough-cookie + undici の CookieAgent が必須
 */

import { CookieJar } from 'tough-cookie';
import { Agent, fetch, RequestInit, Response } from 'undici';
import type { B2Session } from './types';

/**
 * ログイン設定
 */
export interface LoginConfig {
  /** お客様コード */
  customerCode: string;
  /** パスワード */
  customerPassword: string;
  /** 枝番（通常空） */
  customerClsCode?: string;
  /** 個人ユーザーID（通常空） */
  loginUserId?: string;
}

/**
 * Cookie対応の undici Agent を作成
 *
 * ★注意: undici の CookieAgent が内部で 3ドメイン間の Cookie を共有する
 */
function createCookieAgent(cookieJar: CookieJar): Agent {
  return new Agent({
    // B2クラウドは古いTLS設定の可能性があるため、後日検証要
    // Python版では AES128-SHA を強制指定している
    connect: {
      // TLS設定（必要に応じて cipher 調整）
      rejectUnauthorized: true,
    },
  });
}

/**
 * fetch wrapper: tough-cookie と連携して Cookie を自動管理
 */
async function cookieFetch(
  url: string,
  init: RequestInit | undefined,
  jar: CookieJar
): Promise<Response> {
  // リクエスト前: Cookie を付与
  const cookieHeader = await jar.getCookieString(url);
  const headers = new Headers(init?.headers as any);
  if (cookieHeader) {
    headers.set('Cookie', cookieHeader);
  }

  const res = await fetch(url, {
    ...init,
    headers: headers as any,
    redirect: 'manual', // リダイレクトは手動追跡して Cookie を保存
  });

  // レスポンス: Set-Cookie を jar に保存
  const setCookies = res.headers.getSetCookie?.() ?? [];
  for (const sc of setCookies) {
    await jar.setCookie(sc, url);
  }

  return res;
}

/**
 * ヤマトビジネスメンバーズにログインして B2クラウドセッションを確立
 *
 * @param config ログイン情報
 * @returns 確立済みセッション
 */
export async function login(config: LoginConfig): Promise<B2Session> {
  const jar = new CookieJar();

  // ============================================================
  // Step 1: ヤマトビジネスメンバーズへのログイン
  // ============================================================
  const loginUrl = 'https://bmypageapi.kuronekoyamato.co.jp/bmypageapi/login';
  const loginForm = new URLSearchParams({
    CSTMR_CD: config.customerCode,
    CSTMR_PSWD: config.customerPassword,
    BTN_NM: 'LOGIN',
    serviceType: 'portal',
  });

  if (config.customerClsCode) {
    loginForm.set('CSTMR_CLS_CD', config.customerClsCode);
  }
  if (config.loginUserId) {
    loginForm.set('LOGIN_USER_ID', config.loginUserId);
  }

  const loginRes = await cookieFetch(
    loginUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: loginForm.toString(),
    },
    jar
  );

  if (!loginRes.ok && loginRes.status !== 302) {
    throw new Error(
      `Login failed at Step 1 (BmyPage login): HTTP ${loginRes.status}`
    );
  }

  // ============================================================
  // Step 2: serviceUrl を動的取得（B2クラウドサービス）
  // ============================================================
  const me0002Url = 'https://bmypage.kuronekoyamato.co.jp/bmypage/ME0002.json';
  const me0002Res = await cookieFetch(
    me0002Url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId: '06' }), // B2クラウドのserviceId
    },
    jar
  );

  if (!me0002Res.ok) {
    throw new Error(
      `Login failed at Step 2 (ME0002 serviceUrl): HTTP ${me0002Res.status}`
    );
  }

  const me0002Data = (await me0002Res.json()) as { serviceUrl?: string };
  const serviceUrl = me0002Data.serviceUrl;
  if (!serviceUrl) {
    throw new Error(
      'Login failed at Step 2: serviceUrl missing in ME0002 response'
    );
  }

  // ============================================================
  // Step 3: B2クラウドへのリダイレクト追跡
  // ============================================================
  let currentUrl = serviceUrl;
  let baseUrl = '';
  const maxRedirects = 10;

  for (let i = 0; i < maxRedirects; i++) {
    const res = await cookieFetch(currentUrl, { method: 'GET' }, jar);

    if (res.status >= 200 && res.status < 300) {
      // 最終ページに到達
      const urlObj = new URL(currentUrl);
      baseUrl = `${urlObj.protocol}//${urlObj.host}`;
      break;
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('Location');
      if (!location) {
        throw new Error(
          `Login failed at Step 3: redirect without Location at ${currentUrl}`
        );
      }
      // 相対URLを絶対URLに解決
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    throw new Error(
      `Login failed at Step 3: unexpected HTTP ${res.status} at ${currentUrl}`
    );
  }

  if (!baseUrl) {
    throw new Error('Login failed at Step 3: did not reach B2 Cloud');
  }

  // ============================================================
  // Step 4: msgpack用テンプレート取得（1115行、約50KB）
  // ============================================================
  const templateUrl = `${baseUrl}/b2/d/_settings/template`;
  const templateRes = await cookieFetch(templateUrl, { method: 'GET' }, jar);

  if (!templateRes.ok) {
    throw new Error(
      `Login failed at Step 4 (template): HTTP ${templateRes.status}`
    );
  }

  const templateText = await templateRes.text();
  const template = templateText.split(/\r?\n/);

  return {
    baseUrl,
    cookieJar: jar,
    template,
    customerCode: config.customerCode,
    customerPassword: config.customerPassword,
    customerClsCode: config.customerClsCode,
    loginUserId: config.loginUserId,
    loginAt: new Date(),
  };
}

/**
 * セッションが有効か確認
 * 軽量なAPI呼び出しで判定（ブランクのcheckonlyなど）
 */
export async function isSessionAlive(session: B2Session): Promise<boolean> {
  try {
    const res = await cookieFetch(
      `${session.baseUrl}/b2/p/new?checkonly`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feed: { entry: [{ shipment: { service_type: '0' } }] } }),
      },
      session.cookieJar
    );
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * セッション再ログイン（タイムアウト時の自動復旧用）
 */
export async function renewSession(session: B2Session): Promise<B2Session> {
  return login({
    customerCode: session.customerCode,
    customerPassword: session.customerPassword,
    customerClsCode: session.customerClsCode,
    loginUserId: session.loginUserId,
  });
}

/**
 * Cookie付きで任意のURLにアクセスするヘルパー
 * b2client から利用される
 */
export { cookieFetch };
