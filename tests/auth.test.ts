/**
 * auth.ts ユニットテスト
 *
 * resolveLoginConfig のヘッダーオーバーライド挙動を検証
 * （実 B2クラウドへのログインは E2E テストで実施）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveLoginConfig } from '../src/auth';

describe('resolveLoginConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.B2_CUSTOMER_CODE;
    delete process.env.B2_CUSTOMER_PASSWORD;
    delete process.env.B2_CUSTOMER_CLS_CODE;
    delete process.env.B2_LOGIN_USER_ID;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('環境変数も headers も無いと例外を投げる', () => {
    expect(() => resolveLoginConfig({})).toThrow(/認証情報が設定されていません/);
  });

  it('環境変数のみで設定できる', () => {
    process.env.B2_CUSTOMER_CODE = '0482540070';
    process.env.B2_CUSTOMER_PASSWORD = 'mimimi555';
    const c = resolveLoginConfig({});
    expect(c.customerCode).toBe('0482540070');
    expect(c.customerPassword).toBe('mimimi555');
    expect(c.customerClsCode).toBeUndefined();
    expect(c.loginUserId).toBeUndefined();
  });

  it('headers が環境変数より優先される', () => {
    process.env.B2_CUSTOMER_CODE = 'env_code';
    process.env.B2_CUSTOMER_PASSWORD = 'env_pwd';
    const c = resolveLoginConfig({
      'x-b2-customer-code': 'header_code',
      'x-b2-customer-password': 'header_pwd',
      'x-b2-customer-cls-code': '01',
      'x-b2-login-user-id': 'user1',
    });
    expect(c.customerCode).toBe('header_code');
    expect(c.customerPassword).toBe('header_pwd');
    expect(c.customerClsCode).toBe('01');
    expect(c.loginUserId).toBe('user1');
  });

  it('Customer Cls Code / Login User ID は省略可', () => {
    process.env.B2_CUSTOMER_CODE = '0482540070';
    process.env.B2_CUSTOMER_PASSWORD = 'mimimi555';
    const c = resolveLoginConfig({});
    expect(c.customerClsCode).toBeUndefined();
    expect(c.loginUserId).toBeUndefined();
  });

  it('headers の値が配列（multi-value）でも先頭を使う', () => {
    process.env.B2_CUSTOMER_CODE = '0482540070';
    process.env.B2_CUSTOMER_PASSWORD = 'envpwd';
    const c = resolveLoginConfig({
      'x-b2-customer-password': ['header_pwd_1', 'header_pwd_2'],
    });
    expect(c.customerPassword).toBe('header_pwd_1');
  });

  it('headers キーは大文字小文字を吸収する（lowercase で引く）', () => {
    process.env.B2_CUSTOMER_CODE = 'env';
    process.env.B2_CUSTOMER_PASSWORD = 'envpwd';
    // Vercel の req.headers は基本 lowercase だが念のため
    const c = resolveLoginConfig({
      'x-b2-customer-code': 'lowercase_code',
    });
    expect(c.customerCode).toBe('lowercase_code');
  });
});
