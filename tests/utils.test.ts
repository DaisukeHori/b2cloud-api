/**
 * utils.ts テスト
 */

import { describe, it, expect } from 'vitest';
import { toBase64, fromBase64, errorMessage } from '../src/utils';

describe('toBase64 / fromBase64', () => {
  it('ラウンドトリップで復元', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 255, 0]);
    const b64 = toBase64(original);
    const restored = fromBase64(b64);
    expect(Array.from(restored)).toEqual(Array.from(original));
  });

  it('空 Uint8Array → 空 base64', () => {
    expect(toBase64(new Uint8Array())).toBe('');
  });
});

describe('errorMessage', () => {
  it('Error オブジェクト → message', () => {
    expect(errorMessage(new Error('fail'))).toBe('fail');
  });

  it('文字列そのまま', () => {
    expect(errorMessage('boom')).toBe('boom');
  });

  it('null/undefined でも string 化', () => {
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
  });
});
