/**
 * b2client.ts テスト（単体テスト、ネットワーク非依存）
 *
 * ★設計書 4-9 参照
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

// ============================================================
// エラークラス階層
// ============================================================

describe('B2CloudError', () => {
  it('name / statusCode / responseBody を持つ', () => {
    const err = new B2CloudError('msg', 500, 'body');
    expect(err.name).toBe('B2CloudError');
    expect(err.message).toBe('msg');
    expect(err.statusCode).toBe(500);
    expect(err.responseBody).toBe('body');
  });

  it('Error のインスタンス', () => {
    const err = new B2CloudError('x', 500);
    expect(err).toBeInstanceOf(Error);
  });

  it('responseBody は optional', () => {
    const err = new B2CloudError('x', 500);
    expect(err.responseBody).toBeUndefined();
  });

  it.each([400, 401, 403, 404, 409, 500, 502, 503])(
    'statusCode=%s',
    (code) => {
      const err = new B2CloudError('x', code);
      expect(err.statusCode).toBe(code);
    }
  );
});

describe('B2ValidationError', () => {
  it('B2CloudError のサブクラス', () => {
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

  it('name は B2ValidationError', () => {
    const err = new B2ValidationError('test', []);
    expect(err.name).toBe('B2ValidationError');
  });

  it('errors が空でもOK', () => {
    const err = new B2ValidationError('test', []);
    expect(err.errors).toHaveLength(0);
  });

  it('複数エラーを保持できる', () => {
    const err = new B2ValidationError('test', [
      { error_code: 'E1', error_property_name: 'a', error_description: 'A' },
      { error_code: 'E2', error_property_name: 'b', error_description: 'B' },
      { error_code: 'E3', error_property_name: 'c', error_description: 'C' },
    ]);
    expect(err.errors).toHaveLength(3);
    expect(err.errors[0].error_code).toBe('E1');
    expect(err.errors[2].error_property_name).toBe('c');
  });
});

describe('B2SessionExpiredError', () => {
  it('statusCode=401、Error のサブクラス', () => {
    const err = new B2SessionExpiredError();
    expect(err).toBeInstanceOf(B2CloudError);
    expect(err.statusCode).toBe(401);
  });

  it('name は B2SessionExpiredError', () => {
    const err = new B2SessionExpiredError();
    expect(err.name).toBe('B2SessionExpiredError');
  });

  it('引数不要でインスタンス化可能', () => {
    const err = new B2SessionExpiredError();
    expect(err.message).toContain('セッション');
  });
});

// ============================================================
// isValidPdf
// ============================================================

describe('isValidPdf', () => {
  it('先頭が %PDF なら true', () => {
    const buf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    expect(isValidPdf(buf)).toBe(true);
  });

  it('96バイトの HTML エラーレスポンスは false', () => {
    const html = '<html><script>parent.location.href="/sys_err.html"</script></html>';
    const buf = new TextEncoder().encode(html);
    expect(isValidPdf(buf)).toBe(false);
  });

  it('短すぎるバイト列は false', () => {
    expect(isValidPdf(new Uint8Array([0x25, 0x50, 0x44]))).toBe(false);
  });

  it('空バイト列は false', () => {
    expect(isValidPdf(new Uint8Array([]))).toBe(false);
  });

  it('4バイト %PDF のみも false（5バイト以上必須）', () => {
    expect(isValidPdf(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe(false);
  });

  it('正確に 5バイトで %PDF- なら true', () => {
    expect(isValidPdf(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(true);
  });

  it.each([
    [[0x26, 0x50, 0x44, 0x46, 0x2d]], // &PDF
    [[0x25, 0x51, 0x44, 0x46, 0x2d]], // %QDF
    [[0x25, 0x50, 0x45, 0x46, 0x2d]], // %PEF
    [[0x25, 0x50, 0x44, 0x47, 0x2d]], // %PDG
  ])('1バイト違いで false', (bytes) => {
    expect(isValidPdf(new Uint8Array(bytes))).toBe(false);
  });

  it('実際の PDF ヘッダ（PDF 1.7）', () => {
    const pdfHeader = new TextEncoder().encode('%PDF-1.7\n');
    expect(isValidPdf(pdfHeader)).toBe(true);
  });

  it('null bytes の後に %PDF でも先頭は null なので false', () => {
    const buf = new Uint8Array([0x00, 0x25, 0x50, 0x44, 0x46]);
    expect(isValidPdf(buf)).toBe(false);
  });
});

// ============================================================
// generateUniqueKey
// ============================================================

describe('generateUniqueKey', () => {
  it('英数字のみ、16文字以内', () => {
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
    expect(a === b).toBe(false);
  });

  it('デフォルト prefix は API', () => {
    const key = generateUniqueKey();
    expect(key.startsWith('API')).toBe(true);
  });

  it.each(['API', 'TEST', 'DEMO', 'X', 'PRE'])(
    'prefix "%s" で開始',
    (prefix) => {
      expect(generateUniqueKey(prefix).startsWith(prefix)).toBe(true);
    }
  );

  it('50回連続実行で大半がユニーク（衝突ほぼなし）', () => {
    // 16文字制限により prefix="API"(3文字) + timestamp(10文字) + counter(3文字) = 16文字
    const keys = new Set<string>();
    for (let i = 0; i < 50; i++) {
      keys.add(generateUniqueKey('API'));
    }
    // ミリ秒が同じなら counter が効くので基本ユニーク
    expect(keys.size).toBeGreaterThanOrEqual(45);
  });

  it('prefix が長くても 16文字以内に切り詰められる', () => {
    const key = generateUniqueKey('VERYLONGPREFIX');
    expect(key.length).toBeLessThanOrEqual(16);
  });

  it('長い prefix でも英数字のみ', () => {
    const key = generateUniqueKey('LONGPRE');
    expect(/^[A-Za-z0-9]+$/.test(key)).toBe(true);
  });

  it('空 prefix でも動作', () => {
    const key = generateUniqueKey('');
    expect(/^[0-9]+$/.test(key)).toBe(true);
    expect(key.length).toBeLessThanOrEqual(16);
  });
});

// ============================================================
// sleep
// ============================================================

describe('sleep', () => {
  it('指定ミリ秒待機する (50ms)', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45);
  });

  it('0 ms でも解決される', async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
  });

  it('Promise を返す', () => {
    const p = sleep(1);
    expect(p).toBeInstanceOf(Promise);
    return p;
  });

  it('直列実行で合計時間が積み上がる', async () => {
    const start = Date.now();
    await sleep(20);
    await sleep(20);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(35);
  });

  it('並列実行では最長が効く', async () => {
    const start = Date.now();
    await Promise.all([sleep(30), sleep(30), sleep(30)]);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100); // 90ms ではなく 30ms 台
  });
});
