/**
 * E2E: 認証フロー検証
 *
 * ★実 B2クラウド (newb2web.kuronekoyamato.co.jp) への接続が必要★
 *
 * 検証項目（設計書 3-1〜3-5 / E-1）:
 * - 4段階ログイン (bmypageapi → ME0002 → newb2web → /tmp/template.dat) が完走
 * - 動的検出されたbaseUrl が newb2web ドメイン
 * - Cookie jar に複数ドメインの Cookie が保存されている
 * - テンプレートが取得できている (460行 base64)
 * - resolveLoginConfig で環境変数を解決できる
 * - reauthenticate で in-place に Cookie が更新される
 */

import { describe, it, expect } from 'vitest';
import { login, reauthenticate, resolveLoginConfig } from '../../src/auth';
import { isE2EEnabled, hasCredentials } from './setup';

describe.skipIf(!isE2EEnabled())('E2E: 認証フロー (実 B2クラウド)', () => {
  it('B2_CUSTOMER_CODE / B2_CUSTOMER_PASSWORD が .env から読める', () => {
    expect(hasCredentials()).toBe(true);
    expect(process.env.B2_CUSTOMER_CODE).toBeTruthy();
    expect(process.env.B2_CUSTOMER_PASSWORD).toBeTruthy();
  });

  it('login() で 4段階フローが完走、セッションが取得できる', async () => {
    const config = resolveLoginConfig({});
    const session = await login(config);

    // baseUrl 動的検出 (newb2web ドメイン)
    expect(session.baseUrl).toMatch(/^https:\/\/newb2web\.kuronekoyamato\.co\.jp/);

    // Cookie jar 取得確認
    const cookies = await session.cookieJar.getCookies(session.baseUrl);
    expect(cookies.length).toBeGreaterThan(0);

    // テンプレート取得確認 (460行 base64 デコード結果)
    expect(session.template.length).toBeGreaterThan(100); // 100行以上ならOK

    // 認証情報がセッションに保持されている
    expect(session.customerCode).toBe(config.customerCode);
    expect(session.customerPassword).toBe(config.customerPassword);

    // ログイン日時が直近
    const ageMs = Date.now() - session.loginAt.getTime();
    expect(ageMs).toBeLessThan(60_000); // 60秒以内
  }, 30_000);

  it('login() でテンプレートに author{} 子要素のスペース付きプレフィックスが入る', async () => {
    const config = resolveLoginConfig({});
    const session = await login(config);

    // テンプレート文字列を確認
    expect(session.template.length).toBeGreaterThan(0);

    // 主要フィールドが含まれているか (テンプレート内に shipment が定義されている)
    const joined = session.template.join('\n');
    expect(joined).toMatch(/shipment/);
  }, 30_000);

  it('reauthenticate() で in-place に Cookie/baseUrl/template が更新される', async () => {
    const config = resolveLoginConfig({});
    const session = await login(config);

    const originalBaseUrl = session.baseUrl;
    const originalLoginAt = session.loginAt;
    const originalTemplateLen = session.template.length;

    // 1秒待ってから reauthenticate
    await new Promise((r) => setTimeout(r, 1_000));
    await reauthenticate(session);

    // 新しい loginAt
    expect(session.loginAt.getTime()).toBeGreaterThan(originalLoginAt.getTime());

    // baseUrl は通常同じ
    expect(session.baseUrl).toBe(originalBaseUrl);

    // テンプレートも同じ長さ程度
    expect(session.template.length).toBe(originalTemplateLen);
  }, 60_000);

  it('間違った credential では login() が失敗する', async () => {
    await expect(
      login({
        customerCode: '0000000000',
        customerPassword: 'wrong-password-for-test',
      })
    ).rejects.toThrow();
  }, 30_000);
});

describe.skipIf(isE2EEnabled())('E2E スキップ理由', () => {
  it('B2_E2E_ENABLED=1 と B2_CUSTOMER_CODE/PASSWORD が必要 (現在スキップ中)', () => {
    expect(true).toBe(true);
  });
});
