/**
 * settings.ts テスト（selectPrintType のテーブルのみ、ネットワーク非依存）
 *
 * ★設計書 5-3-2-B 参照
 */

import { describe, it, expect } from 'vitest';
import { selectPrintType } from '../src/settings';

describe('selectPrintType', () => {
  it('a4_multi → "m"', () => {
    expect(selectPrintType('0', 'a4_multi')).toBe('m');
    expect(selectPrintType('5', 'a4_multi')).toBe('m');
  });

  it('a5_multi → "m5"', () => {
    expect(selectPrintType('0', 'a5_multi')).toBe('m5');
    expect(selectPrintType('5', 'a5_multi')).toBe('m5');
  });

  it('label: 発払い(0) → "4"（発払い専用ラベル）', () => {
    expect(selectPrintType('0', 'label')).toBe('4');
  });

  it('label: タイム(4) → "4"', () => {
    expect(selectPrintType('4', 'label')).toBe('4');
  });

  it('label: コレクト(2) → "2"', () => {
    expect(selectPrintType('2', 'label')).toBe('2');
  });

  it('label: ゆうパケット(7) → "7"', () => {
    expect(selectPrintType('7', 'label')).toBe('7');
  });

  it('label: ネコポス(A) → "A"', () => {
    expect(selectPrintType('A', 'label')).toBe('A');
  });

  it('★label 非対応 service_type (3/5/8/9) はエラー', () => {
    expect(() => selectPrintType('3', 'label')).toThrow(/ラベルプリンタ印刷に対応していません/);
    expect(() => selectPrintType('5', 'label')).toThrow();
    expect(() => selectPrintType('8', 'label')).toThrow();
    expect(() => selectPrintType('9', 'label')).toThrow();
  });
});
