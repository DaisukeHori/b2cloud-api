/**
 * B2クラウド 認証・セッション管理
 *
 * ★実機検証ベース（2026-04-16 Playwright 実ブラウザフロー観察で再確定）★
 *
 * ログインフロー（5段階）:
 *   0. GET https://bmypage.kuronekoyamato.co.jp/bmypage/index.html
 *      (★必須★ ログインページ事前取得で bmypage 側の セッション/トラッキング Cookie を確立)
 *      これが無いと Step 1 が HTTP 500 「【システムエラー】本サービスを継続することができません」
 *
 *   1. POST https://bmypageapi.kuronekoyamato.co.jp/bmypageapi/login
 *      (ヤマトビジネスメンバーズへの form POST、実 form submit を完全模倣)
 *      フィールド: quickLoginCheckH=0, BTN_NM=LOGIN, serviceType=portal,
 *                  CSTMR_CD, CSTMR_CLS_CD（空文字も明示）, CSTMR_PSWD,
 *                  LOGIN_USER_ID（空文字も明示）
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
  // Step 0: bmypage ログインページ事前取得（Cookie 確立）
  //
  // ★実ブラウザフロー (2026-04-16 Playwright観察) で必須と判明★
  //   このページを開かずに直接 bmypageapi/login へ POST すると
  //   ヤマト側 Apache が HTTP 500「【システムエラー】本サービスを継続することができません」
  //   を返す（「ブラウザの戻る/進む・URL 直接指定」エラー画面）。
  //   bmypage 側のセッション Cookie + Rtoaster トラッキング Cookie 等が
  //   set-cookie で降りてくる。
  // ============================================================
  const loginPageUrl =
    'https://bmypage.kuronekoyamato.co.jp/bmypage/index.html';
  const step0Res = await cookieFetch(
    loginPageUrl,
    { method: 'GET' },
    jar
  );
  if (!step0Res.ok) {
    throw new Error(
      `Login failed at Step 0 (bmypage GET): HTTP ${step0Res.status}`
    );
  }

  // ============================================================
  // Step 1: ヤマトビジネスメンバーズへのログイン
  //
  // ★実ブラウザの form submit (func_request_Link in ybmCommon) を完全模倣★
  //   document.frm の hidden 含む全フィールド (空文字含む) を送信する必要あり:
  //     quickLoginCheckH=0
  //     BTN_NM=LOGIN
  //     serviceType=portal
  //     CSTMR_CD={customerCode}
  //     CSTMR_CLS_CD={枝番、空文字も明示}
  //     CSTMR_PSWD={password}
  //     LOGIN_USER_ID={個人ユーザーID、空文字も明示}
  //   実ブラウザでは disabled になる username, KOJIN は送らない
  // ============================================================
  const loginUrl = 'https://bmypageapi.kuronekoyamato.co.jp/bmypageapi/login';
  const loginForm = new URLSearchParams({
    quickLoginCheckH: '0',
    BTN_NM: 'LOGIN',
    serviceType: 'portal',
    CSTMR_CD: config.customerCode,
    CSTMR_CLS_CD: config.customerClsCode ?? '',
    CSTMR_PSWD: config.customerPassword,
    LOGIN_USER_ID: config.loginUserId ?? '',
  });

  const loginRes = await cookieFetch(
    loginUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // ★bmypage からの遷移を装うために Origin/Referer を付与
        Origin: 'https://bmypage.kuronekoyamato.co.jp',
        Referer: 'https://bmypage.kuronekoyamato.co.jp/bmypage/index.html',
      },
      body: loginForm.toString(),
    },
    jar
  );

  if (!loginRes.ok && loginRes.status !== 302) {
    // エラーレスポンスのHTMLから状況を診断するためボディも読む
    let body = '';
    try {
      body = (await loginRes.text()).substring(0, 200);
    } catch {}
    throw new Error(
      `Login failed at Step 1 (BmyPage login): HTTP ${loginRes.status}` +
        (body ? ` body=${body}` : '')
    );
  }

  // ============================================================
  // Step 2: serviceUrl を動的取得（B2クラウドサービス）
  //
  // ★実ブラウザフロー (2026-04-16 Playwright で確証) 通りの実装★
  //   元JS: ybmCommonJs.useService('06', '2') 内の $.ajax({...})
  //     - dataType: "json" は **レスポンス** の型指定であって、
  //       リクエストの Content-Type ではない！
  //     - jQuery $.ajax のデフォルト Content-Type = application/x-www-form-urlencoded
  //     - data: { serviceId: '06' } → "serviceId=06" として送信される
  //
  //   レスポンス例:
  //     { "accessible": "1",
  //       "bmypagesession": "...",
  //       "branchFlg": "0",
  //       "dispatchType": "1",
  //       "loginRelationType": "1",
  //       "serviceId": "06",
  //       "serviceUrl": "https://newb2web.kuronekoyamato.co.jp/b2/d/_html/index.html?oauth&call_service_code=A",
  //       "showUserReview": "0",
  //       ... }
  //
  // ★以前は Content-Type: application/json で送っていてサーバーがログイン画面の
  //   HTML を返却していた（JSON parse SyntaxError の原因）
  // ============================================================
  const me0002Url = 'https://bmypage.kuronekoyamato.co.jp/bmypage/ME0002.json';
  const me0002Form = new URLSearchParams({ serviceId: '06' });

  const me0002Res = await cookieFetch(
    me0002Url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        Origin: 'https://bmypage.kuronekoyamato.co.jp',
        Referer:
          'https://bmypage.kuronekoyamato.co.jp/bmypage/servlet/jp.co.kuronekoyamato.wur.hmp.servlet.user.HMPLGI0010JspServlet',
      },
      body: me0002Form.toString(),
    },
    jar
  );

  if (!me0002Res.ok) {
    let body = '';
    try {
      body = (await me0002Res.text()).substring(0, 200);
    } catch {}
    throw new Error(
      `Login failed at Step 2 (ME0002 serviceUrl): HTTP ${me0002Res.status}` +
        (body ? ` body=${body}` : '')
    );
  }

  // レスポンスは text/html ではなく application/json で来るはず
  const me0002Text = await me0002Res.text();
  let me0002Data: { serviceUrl?: string; accessible?: string; bmypagesession?: string };
  try {
    me0002Data = JSON.parse(me0002Text);
  } catch (parseErr) {
    throw new Error(
      `Login failed at Step 2: JSON parse failed (likely returned HTML login page): ` +
        me0002Text.substring(0, 200)
    );
  }

  if (me0002Data.accessible !== '1') {
    throw new Error(
      `Login failed at Step 2: B2クラウドサービスが利用不可 (accessible=${me0002Data.accessible})`
    );
  }

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

// ============================================================
// 環境変数 + ヘッダーからの LoginConfig 取得
// ============================================================

/**
 * 環境変数 + リクエストヘッダーから LoginConfig を構築
 *
 * ★設計書 7章 参照
 *   - X-B2-Customer-Code 等のヘッダがあれば環境変数より優先
 *   - 未指定の場合は B2_CUSTOMER_CODE / B2_CUSTOMER_PASSWORD 等を環境変数から読む
 *
 * @param headers リクエストヘッダ（Vercel/Node の req.headers をそのまま渡せる）
 * @returns ログイン設定
 * @throws 認証情報が不足している場合
 */
export function resolveLoginConfig(
  headers: Record<string, string | string[] | undefined> = {}
): LoginConfig {
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
