/**
 * utils.ts テスト（単体テスト）
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

  it('1バイト', () => {
    expect(toBase64(new Uint8Array([0x41]))).toBe('QQ==');
  });

  it('ASCII 文字列を base64 化', () => {
    const bytes = new TextEncoder().encode('Hello');
    expect(toBase64(bytes)).toBe('SGVsbG8=');
  });

  it('fromBase64 は空文字→空配列', () => {
    expect(fromBase64('').length).toBe(0);
  });

  it.each([
    [new Uint8Array([0])],
    [new Uint8Array([255])],
    [new Uint8Array([0, 255])],
    [new Uint8Array([1, 2, 3])],
    [new Uint8Array([0x25, 0x50, 0x44, 0x46])], // %PDF
    [new Uint8Array(Array.from({ length: 64 }, (_, i) => i))],
    [new Uint8Array(Array.from({ length: 128 }, (_, i) => i * 2))],
    [new Uint8Array(Array.from({ length: 256 }, (_, i) => i & 0xff))],
  ])('ラウンドトリップ: %#', (bytes) => {
    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it('改行を含む base64 もデコード可能（Buffer の挙動）', () => {
    // "Hello" base64 = "SGVsbG8="
    const withNl = 'SGVsb\nG8=';
    expect(new TextDecoder().decode(fromBase64(withNl))).toBe('Hello');
  });
});

describe('errorMessage', () => {
  it('Error オブジェクト → message', () => {
    expect(errorMessage(new Error('fail'))).toBe('fail');
  });

  it('TypeError → message', () => {
    expect(errorMessage(new TypeError('bad'))).toBe('bad');
  });

  it('Error サブクラス → message', () => {
    class MyError extends Error {}
    expect(errorMessage(new MyError('sub'))).toBe('sub');
  });

  it('文字列そのまま', () => {
    expect(errorMessage('boom')).toBe('boom');
  });

  it('null/undefined でも string 化', () => {
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
  });

  it('数値 → 文字列化', () => {
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(0)).toBe('0');
  });

  it('真偽値 → 文字列化', () => {
    expect(errorMessage(true)).toBe('true');
    expect(errorMessage(false)).toBe('false');
  });

  it('オブジェクトは string 化（[object Object]）', () => {
    expect(errorMessage({ a: 1 })).toBe('[object Object]');
  });

  it('配列 → カンマ区切り', () => {
    expect(errorMessage([1, 2, 3])).toBe('1,2,3');
  });
});
