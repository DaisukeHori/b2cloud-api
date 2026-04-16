/**
 * session-store.ts テスト
 *
 * resolveLoginConfig のヘッダーオーバーライド挙動のみ検証（ログイン実行はしない）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveLoginConfig } from '../src/session-store';

describe('resolveLoginConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // 環境変数をクリア
    delete process.env.B2_CUSTOMER_CODE;
    delete process.env.B2_CUSTOMER_PASSWORD;
    delete process.env.B2_CUSTOMER_CLS_CODE;
    delete process.env.B2_LOGIN_USER_ID;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('環境変数が無くヘッダーも無い場合はエラー', () => {
    expect(() => resolveLoginConfig({})).toThrow(/認証情報が設定されていません/);
  });

  it('環境変数から取得', () => {
    process.env.B2_CUSTOMER_CODE = '0482540070';
    process.env.B2_CUSTOMER_PASSWORD = 'mimimi555';
    const c = resolveLoginConfig({});
    expect(c.customerCode).toBe('0482540070');
    expect(c.customerPassword).toBe('mimimi555');
  });

  it('ヘッダーが環境変数より優先される', () => {
    process.env.B2_CUSTOMER_CODE = 'env-code';
    process.env.B2_CUSTOMER_PASSWORD = 'env-pw';
    const c = resolveLoginConfig({
      'x-b2-customer-code': 'header-code',
      'x-b2-customer-password': 'header-pw',
    });
    expect(c.customerCode).toBe('header-code');
    expect(c.customerPassword).toBe('header-pw');
  });

  it('customerClsCode / loginUserId は optional（空文字は undefined に）', () => {
    process.env.B2_CUSTOMER_CODE = '0482540070';
    process.env.B2_CUSTOMER_PASSWORD = 'mimimi555';
    const c = resolveLoginConfig({});
    expect(c.customerClsCode).toBeUndefined();
    expect(c.loginUserId).toBeUndefined();
  });
});
