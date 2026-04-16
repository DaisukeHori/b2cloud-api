/**
 * settings.ts テスト（単体テスト、ネットワーク非依存）
 *
 * ★設計書 5-3-2-B 参照
 */

import { describe, it, expect } from 'vitest';
import { selectPrintType } from '../src/settings';

describe('selectPrintType — a4_multi', () => {
  it.each(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A'])(
    'service_type=%s の a4_multi は "m"',
    (st) => {
      expect(selectPrintType(st as any, 'a4_multi')).toBe('m');
    }
  );
});

describe('selectPrintType — a5_multi', () => {
  it.each(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A'])(
    'service_type=%s の a5_multi は "m5"',
    (st) => {
      expect(selectPrintType(st as any, 'a5_multi')).toBe('m5');
    }
  );
});

describe('selectPrintType — label', () => {
  it('発払い(0) → "4"（発払い専用ラベル）', () => {
    expect(selectPrintType('0', 'label')).toBe('4');
  });

  it('コレクト(2) → "2"', () => {
    expect(selectPrintType('2', 'label')).toBe('2');
  });

  it('タイム(4) → "4"', () => {
    expect(selectPrintType('4', 'label')).toBe('4');
  });

  it('ゆうパケット(7) → "7"', () => {
    expect(selectPrintType('7', 'label')).toBe('7');
  });

  it('ネコポス(A) → "A"', () => {
    expect(selectPrintType('A', 'label')).toBe('A');
  });

  it.each(['3', '5', '8', '9'])(
    '★label 非対応 service_type=%s はエラー',
    (st) => {
      expect(() => selectPrintType(st as any, 'label')).toThrow(
        /ラベルプリンタ印刷に対応していません/
      );
    }
  );

  it('エラーメッセージに service_type が含まれる', () => {
    expect(() => selectPrintType('3' as any, 'label')).toThrow(/service_type=3/);
    expect(() => selectPrintType('5' as any, 'label')).toThrow(/service_type=5/);
  });

  it('エラーメッセージに設計書セクション番号が含まれる', () => {
    expect(() => selectPrintType('3' as any, 'label')).toThrow(/5-3-2-B/);
  });
});

describe('selectPrintType — 全組み合わせ網羅', () => {
  const serviceTypes = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A'];
  const formats = ['a4_multi', 'a5_multi'] as const;

  // a4_multi / a5_multi は全 service_type で成功
  for (const st of serviceTypes) {
    for (const fmt of formats) {
      it(`${st} × ${fmt} → 成功`, () => {
        expect(() => selectPrintType(st as any, fmt)).not.toThrow();
      });
    }
  }

  // label 成功
  it.each(['0', '2', '4', '7', 'A'])(
    'label × %s → 成功',
    (st) => {
      expect(() => selectPrintType(st as any, 'label')).not.toThrow();
    }
  );

  // label 失敗
  it.each(['3', '5', '8', '9'])(
    'label × %s → 失敗',
    (st) => {
      expect(() => selectPrintType(st as any, 'label')).toThrow();
    }
  );
});
