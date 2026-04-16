/**
 * b2client.ts テスト（ネットワーク非依存）
 *
 * ★設計書 4-9 参照。以下を検証:
 *   - エラークラス階層
 *   - isValidPdf: PDF マジックバイト判定
 *   - generateUniqueKey: 16文字以内の英数字
 *   - sleep: 非同期待機
 */

import { describe, it, expect } from 'vitest';
import {
  B2CloudError,
  B2ValidationError,
  B2SessionExpiredError,
  isValidPdf,
  generateUniqueKey,
  sleep,
} from '../src/b2client';

describe('エラークラス階層', () => {
  it('B2ValidationError は B2CloudError のサブクラス', () => {
    const err = new B2ValidationError('test', [
      {
        error_code: 'EF011001',
        error_property_name: 'consignee_name',
        error_description: 'お届け先名が入力されていません',
      },
    ]);
    expect(err).toBeInstanceOf(B2CloudError);
    expect(err.statusCode).toBe(400);
    expect(err.errors).toHaveLength(1);
  });

  it('B2SessionExpiredError は statusCode=401', () => {
    const err = new B2SessionExpiredError();
    expect(err).toBeInstanceOf(B2CloudError);
    expect(err.statusCode).toBe(401);
  });
});

describe('isValidPdf', () => {
  it('先頭が %PDF なら true', () => {
    // "%PDF-1.4" の先頭 8 バイト
    const buf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    expect(isValidPdf(buf)).toBe(true);
  });

  it('96バイトの HTML エラーレスポンスは false（設計書 4-5）', () => {
    const html = '<html><script>parent.location.href="/sys_err.html"</script></html>';
    const buf = new TextEncoder().encode(html);
    expect(isValidPdf(buf)).toBe(false);
  });

  it('短すぎるバイト列は false', () => {
    expect(isValidPdf(new Uint8Array([0x25, 0x50, 0x44]))).toBe(false);
  });
});

describe('generateUniqueKey', () => {
  it('英数字のみ、16文字以内（設計書 E-5 #16-a）', () => {
    for (let i = 0; i < 10; i++) {
      const key = generateUniqueKey('API');
      expect(key.length).toBeLessThanOrEqual(16);
      expect(/^[A-Za-z0-9]+$/.test(key)).toBe(true);
    }
  });

  it('prefix を含む', () => {
    const key = generateUniqueKey('TEST');
    expect(key.startsWith('TEST')).toBe(true);
  });

  it('連続実行で異なる値', () => {
    const a = generateUniqueKey();
    const b = generateUniqueKey();
    // ミリ秒単位 + 乱数のため、普通は異なる
    // タイムスタンプが同じでも乱数で分離される
    expect(a === b).toBe(false);
  });
});

describe('sleep', () => {
  it('指定ミリ秒待機する', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45);
  });
});
