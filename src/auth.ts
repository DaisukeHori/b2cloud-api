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
 *   4. GET {baseUrl}/tmp/template.dat
 *      (msgpack用テンプレート 460行 base64 を取得、キャッシュ)
 *      ★設計書 3-4: 旧 /b2/d/_settings/template (1115行) は f2a に使えない別物
 *
 * ★Cookie が 3ドメインにまたがるため tough-cookie + undici の CookieAgent が必須
 */

import { CookieJar } from 'tough-cookie';
import { fetch, RequestInit, Response } from 'undici';
import type { B2Session } from './types';

/** ★CSRF 対策用の User-Agent（設計書 4-9 参照） */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

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
 * fetch wrapper: tough-cookie と連携して Cookie を自動管理
 *
 * ★Node.js から呼ぶ場合は redirect: 'manual' + 手動追跡が必須（設計書 4-10 #5）
 *   fetch 自動リダイレクトだと Cookie が途中で失われる。
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
  if (!headers.has('User-Agent')) {
    headers.set('User-Agent', UA);
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
  // Step 4: msgpack用テンプレート取得（460行、base64エンコード、約10KB）
  // ★設計書 3-4 参照: 正しい URL は /tmp/template.dat（base64、型ヒント除去済）
  //   /b2/d/_settings/template (1115行) は f2a には使えない別物
  // ============================================================
  const templateUrl = `${baseUrl}/tmp/template.dat`;
  const templateRes = await cookieFetch(
    templateUrl,
    {
      method: 'GET',
      headers: {
        Accept: 'application/base64',
        Origin: baseUrl,
        Referer: `${baseUrl}/single_issue_reg.html`,
        'X-Requested-With': 'XMLHttpRequest',
      },
    },
    jar
  );

  let template: string[] = [];
  if (templateRes.ok) {
    const templateB64 = await templateRes.text();
    // base64 decode → 改行 split
    try {
      const decoded = Buffer.from(templateB64.trim(), 'base64').toString(
        'utf-8'
      );
      template = decoded.split(/\r?\n/);
    } catch {
      // base64 以外で返ってきたらそのまま split（防御的フォールバック）
      template = templateB64.split(/\r?\n/);
    }
  }
  // ★テンプレートは msgpack パス使用時のみ必須（設計書 3-4）
  // JSON パスのみで動作させる場合は取得失敗してもログイン続行可能

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
 * セッションを in-place で再ログイン（設計書 4-9 参照）
 *
 * 既存の session オブジェクトの cookieJar / baseUrl / template / loginAt を新セッションの
 * 値で置き換える。b2Request の onReauthenticate コールバックで使う。
 */
export async function reauthenticate(session: B2Session): Promise<void> {
  const fresh = await login({
    customerCode: session.customerCode,
    customerPassword: session.customerPassword,
    customerClsCode: session.customerClsCode,
    loginUserId: session.loginUserId,
  });
  session.cookieJar = fresh.cookieJar;
  session.baseUrl = fresh.baseUrl;
  session.template = fresh.template;
  session.loginAt = fresh.loginAt;
}

/**
 * セッション再ログイン（新しいオブジェクトを返す版、既存コード互換）
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
