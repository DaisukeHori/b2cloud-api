/**
 * session-store.ts テスト（単体テスト、ネットワーク非依存）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveLoginConfig,
  clearAllSessions,
  invalidateSession,
  SESSION_TTL_MS,
  SESSION_REFRESH_MS,
} from '../src/session-store';

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

  it('customerClsCode も環境変数から取得', () => {
    process.env.B2_CUSTOMER_CODE = '0482540070';
    process.env.B2_CUSTOMER_PASSWORD = 'pw';
    process.env.B2_CUSTOMER_CLS_CODE = '000';
    const c = resolveLoginConfig({});
    expect(c.customerClsCode).toBe('000');
  });

  it('loginUserId も環境変数から取得', () => {
    process.env.B2_CUSTOMER_CODE = '0482540070';
    process.env.B2_CUSTOMER_PASSWORD = 'pw';
    process.env.B2_LOGIN_USER_ID = 'user01';
    const c = resolveLoginConfig({});
    expect(c.loginUserId).toBe('user01');
  });

  it('customerClsCode のヘッダ優先', () => {
    process.env.B2_CUSTOMER_CODE = '0482540070';
    process.env.B2_CUSTOMER_PASSWORD = 'pw';
    process.env.B2_CUSTOMER_CLS_CODE = 'env-cls';
    const c = resolveLoginConfig({
      'x-b2-customer-cls-code': 'header-cls',
    });
    expect(c.customerClsCode).toBe('header-cls');
  });

  it('loginUserId のヘッダ優先', () => {
    process.env.B2_CUSTOMER_CODE = '0482540070';
    process.env.B2_CUSTOMER_PASSWORD = 'pw';
    process.env.B2_LOGIN_USER_ID = 'env-user';
    const c = resolveLoginConfig({ 'x-b2-login-user-id': 'header-user' });
    expect(c.loginUserId).toBe('header-user');
  });

  it('パスワードだけヘッダで指定可能', () => {
    process.env.B2_CUSTOMER_CODE = '0482540070';
    const c = resolveLoginConfig({ 'x-b2-customer-password': 'via-header' });
    expect(c.customerPassword).toBe('via-header');
    expect(c.customerCode).toBe('0482540070');
  });

  it('コードだけヘッダで指定可能', () => {
    process.env.B2_CUSTOMER_PASSWORD = 'env-pw';
    const c = resolveLoginConfig({ 'x-b2-customer-code': 'via-header' });
    expect(c.customerCode).toBe('via-header');
    expect(c.customerPassword).toBe('env-pw');
  });

  it('ヘッダ値が配列なら先頭を使う', () => {
    process.env.B2_CUSTOMER_CODE = 'env-code';
    process.env.B2_CUSTOMER_PASSWORD = 'env-pw';
    const c = resolveLoginConfig({
      'x-b2-customer-code': ['first', 'second'],
    });
    expect(c.customerCode).toBe('first');
  });

  it('ヘッダが undefined なら環境変数にフォールバック', () => {
    process.env.B2_CUSTOMER_CODE = 'env-code';
    process.env.B2_CUSTOMER_PASSWORD = 'env-pw';
    const c = resolveLoginConfig({ 'x-b2-customer-code': undefined });
    expect(c.customerCode).toBe('env-code');
  });

  it('password が空文字ならエラー', () => {
    process.env.B2_CUSTOMER_CODE = '0482540070';
    process.env.B2_CUSTOMER_PASSWORD = '';
    expect(() => resolveLoginConfig({})).toThrow(/認証情報/);
  });

  it('customerCode が空文字ならエラー', () => {
    process.env.B2_CUSTOMER_CODE = '';
    process.env.B2_CUSTOMER_PASSWORD = 'pw';
    expect(() => resolveLoginConfig({})).toThrow(/認証情報/);
  });
});

describe('定数', () => {
  it('SESSION_TTL_MS は 30分', () => {
    expect(SESSION_TTL_MS).toBe(30 * 60 * 1000);
  });

  it('SESSION_REFRESH_MS は 25分', () => {
    expect(SESSION_REFRESH_MS).toBe(25 * 60 * 1000);
  });

  it('REFRESH は TTL より短い', () => {
    expect(SESSION_REFRESH_MS).toBeLessThan(SESSION_TTL_MS);
  });
});

describe('clearAllSessions / invalidateSession', () => {
  it('clearAllSessions は例外を投げない', () => {
    expect(() => clearAllSessions()).not.toThrow();
  });

  it('invalidateSession は例外を投げない', () => {
    expect(() =>
      invalidateSession({
        customerCode: 'x',
        customerPassword: 'y',
      })
    ).not.toThrow();
  });

  it('存在しないセッションの invalidate も例外なし', () => {
    clearAllSessions();
    expect(() =>
      invalidateSession({
        customerCode: 'notfound',
        customerPassword: 'x',
      })
    ).not.toThrow();
  });
});
