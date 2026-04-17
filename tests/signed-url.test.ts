/**
 * signed-url.ts テスト — HMAC-SHA256 署名付き URL の生成・検証
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateSignedDownloadPath, verifySignedDownload } from '../src/signed-url';

describe('署名付きダウンロード URL', () => {
  beforeEach(() => {
    process.env.MCP_API_KEY = 'test-secret-key';
  });

  afterEach(() => {
    delete process.env.MCP_API_KEY;
  });

  it('generateSignedDownloadPath がパスを生成する', () => {
    const path = generateSignedDownloadPath('389717757822');
    expect(path).toContain('/api/b2/download?');
    expect(path).toContain('tn=389717757822');
    expect(path).toContain('exp=');
    expect(path).toContain('sig=');
  });

  it('生成した URL が即座に検証を通る', () => {
    const path = generateSignedDownloadPath('389717757822');
    const url = new URL('http://dummy' + path);
    const tn = url.searchParams.get('tn')!;
    const exp = url.searchParams.get('exp')!;
    const sig = url.searchParams.get('sig')!;

    const result = verifySignedDownload(tn, exp, sig);
    expect('trackingNumber' in result).toBe(true);
    if ('trackingNumber' in result) {
      expect(result.trackingNumber).toBe('389717757822');
    }
  });

  it('不正な署名は拒否される', () => {
    const result = verifySignedDownload('389717757822', '9999999999', 'invalid-sig');
    expect('error' in result).toBe(true);
  });

  it('期限切れの URL は拒否される', () => {
    const expiredExp = String(Math.floor(Date.now() / 1000) - 120); // 2分前
    const result = verifySignedDownload('389717757822', expiredExp, 'any-sig');
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('expired');
    }
  });

  it('パラメータ不足は拒否される', () => {
    expect('error' in verifySignedDownload(undefined, '123', 'abc')).toBe(true);
    expect('error' in verifySignedDownload('tn', undefined, 'abc')).toBe(true);
    expect('error' in verifySignedDownload('tn', '123', undefined)).toBe(true);
  });
});
