/**
 * msgpack.ts テスト
 *
 * ★設計書 2-3 参照。以下を検証:
 *   - replaceControlCode: 制御文字除去
 *   - t2m: テンプレート → マッピング辞書
 *   - e2a: entry → 配列
 *   - f2a: feed → 配列（先頭15要素 null + [14]=entry 配列）
 *   - compressFeed: 全パイプライン（f2a → msgpack → deflateRaw）
 */

import { describe, it, expect } from 'vitest';
import { inflateRaw } from 'pako';
import { decode as msgpackDecode } from '@msgpack/msgpack';
import {
  replaceControlCode,
  t2m,
  e2a,
  f2a,
  compressFeed,
  FIELD_PATTERN,
  CONTROL_CODE,
} from '../src/msgpack';

// ============================================================
// replaceControlCode
// ============================================================

describe('replaceControlCode', () => {
  it('undefined / null → 空文字', () => {
    expect(replaceControlCode(undefined)).toBe('');
    expect(replaceControlCode(null)).toBe('');
  });

  it('通常の文字列はそのまま', () => {
    expect(replaceControlCode('Hello 世界')).toBe('Hello 世界');
  });

  it('制御文字 (0x00-0x08) を除去', () => {
    expect(replaceControlCode('abc\x01\x02def')).toBe('abcdef');
    expect(replaceControlCode('A\x00B')).toBe('AB');
  });

  it('\\t (0x09) / \\n (0x0A) は許容される', () => {
    expect(replaceControlCode('a\tb')).toBe('a\tb');
    expect(replaceControlCode('a\nb')).toBe('a\nb');
  });

  it('DEL (0x7F) を除去', () => {
    expect(replaceControlCode('a\x7Fb')).toBe('ab');
  });

  it('数値・真偽値は文字列化', () => {
    expect(replaceControlCode(123)).toBe('123');
    expect(replaceControlCode(true)).toBe('true');
  });
});

// ============================================================
// FIELD_PATTERN
// ============================================================

describe('FIELD_PATTERN', () => {
  it('単純フィールド', () => {
    const m = 'service_type'.match(FIELD_PATTERN);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(''); // indent
    expect(m![2]).toBe('service_type'); // field name
  });

  it('ネストフィールド（スペース付き）', () => {
    const m = ' name'.match(FIELD_PATTERN);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(' '); // indent = 1
    expect(m![2]).toBe('name');
  });

  it('配列記法 {}', () => {
    const m = 'author{}'.match(FIELD_PATTERN);
    expect(m).not.toBeNull();
    expect(m![2]).toBe('author');
  });

  it('必須フラグ !', () => {
    const m = 'service_type!'.match(FIELD_PATTERN);
    expect(m).not.toBeNull();
    expect(m![2]).toBe('service_type');
    expect(m![8]).toBe('!');
  });

  it('型ヒント（letters のみ、★元JSの regex 定義通り）', () => {
    // 元JS の FIELD_PATTERN は型ヒント捕捉が [a-zA-Z$]+ で、
    // `_` や数字を含まない。実 template `/tmp/template.dat` は型ヒント除去済なので影響なし。
    const m = 'package_qty(rdbint)'.match(FIELD_PATTERN);
    expect(m).not.toBeNull();
    expect(m![2]).toBe('package_qty');
    expect(m![3]).toBe('rdbint');
  });
});

// ============================================================
// CONTROL_CODE
// ============================================================

describe('CONTROL_CODE', () => {
  it('\\x00 にマッチ', () => {
    expect('\x00'.match(CONTROL_CODE)).not.toBeNull();
  });
  it('\\t \\n にはマッチしない（許容）', () => {
    // CONTROL_CODE は global フラグ付き、マッチしなければ null
    expect('\t'.match(CONTROL_CODE)).toBeNull();
    expect('\n'.match(CONTROL_CODE)).toBeNull();
  });
});

// ============================================================
// t2m（最小テンプレート）
// ============================================================

describe('t2m', () => {
  it('プレフィックス（16トップレベル要素） + 独自 shipment 構造を正しくマッピング', () => {
    // 最小テンプレート: shipment の service_type のみ
    const template = ['shipment{}', ' service_type!', ' consignee_name'];
    const mapping = t2m(template);

    // トップレベル entry.shipment が存在
    expect(mapping.entry.shipment).toBeDefined();
    // t2m 固定プレフィックスは 16 トップレベル要素:
    //   author, category, content, contributor, id, link, published, rights,
    //   rights____type, summary, summary____type, title, title____type,
    //   subtitle, subtitle____type, updated (0..15)
    // 次の独自フィールド shipment は idx=16
    expect(mapping.entry.shipment._[0]).toBe(16);
    expect(mapping.entry.shipment._[1]).toBe('shipment');
    // 子フィールド
    expect((mapping.entry.shipment as any).service_type._[0]).toBe(0);
    expect((mapping.entry.shipment as any).consignee_name._[0]).toBe(1);
  });

  it('★author{} の子要素 (スペース付き) が正しく子扱いされる', () => {
    // プレフィックスのみ（32要素、author{} の子 3個含む）
    const mapping = t2m([]);
    // author はトップレベル idx=0
    expect((mapping.entry as any).author._[0]).toBe(0);
    // name/uri/email は author の子（idx 0/1/2）
    const author = (mapping.entry as any).author;
    expect(author.name._[0]).toBe(0);
    expect(author.uri._[0]).toBe(1);
    expect(author.email._[0]).toBe(2);
  });
});

// ============================================================
// e2a（最小ケース）
// ============================================================

describe('e2a', () => {
  it('スカラー値を配列化（shipment は idx=16 = プレフィックス 16 要素の直後）', () => {
    const template = ['shipment{}', ' service_type!'];
    const mapping = t2m(template);
    const arr = e2a(mapping, 'entry', {
      shipment: { service_type: '0' },
    });
    expect(arr[16]).toEqual(['0']);
  });

  it('制御文字を除去', () => {
    const template = ['shipment{}', ' service_type!', ' consignee_name'];
    const mapping = t2m(template);
    const arr = e2a(mapping, 'entry', {
      shipment: { service_type: '0', consignee_name: 'abc\x01def' },
    });
    // shipment = arr[16], consignee_name = arr[16][1]
    expect(arr[16][1]).toBe('abcdef');
  });

  it('null / undefined フィールドは空文字', () => {
    const template = ['shipment{}', ' service_type!', ' consignee_name'];
    const mapping = t2m(template);
    const arr = e2a(mapping, 'entry', {
      shipment: { service_type: '0', consignee_name: null },
    });
    expect(arr[16][1]).toBe('');
  });
});

// ============================================================
// f2a
// ============================================================

describe('f2a', () => {
  it('先頭14要素が null、[14] に entry 配列', () => {
    const template = ['shipment{}', ' service_type!'];
    const feedData = { feed: { entry: [{ shipment: { service_type: '0' } }] } };
    const arr = f2a(template, feedData);
    // 全15要素
    expect(arr.length).toBe(15);
    // 先頭14個は null（updated が含まれていれば [13] が上書き）
    for (let i = 0; i < 13; i++) {
      expect(arr[i]).toBeNull();
    }
    // [14] は entry 配列
    expect(Array.isArray(arr[14])).toBe(true);
    expect(arr[14].length).toBe(1);
  });

  it('feed.updated があれば [13] に設定', () => {
    const template = ['shipment{}', ' service_type!'];
    const feedData = {
      feed: {
        updated: '2026-04-16',
        entry: [{ shipment: { service_type: '0' } }],
      },
    };
    const arr = f2a(template, feedData);
    expect(arr[13]).toBe('2026-04-16');
  });
});

// ============================================================
// compressFeed（f2a → msgpack → deflateRaw）
// ============================================================

describe('compressFeed', () => {
  it('出力は Uint8Array、inflateRaw で復元可能', () => {
    const template = ['shipment{}', ' service_type!'];
    const feedData = { feed: { entry: [{ shipment: { service_type: '0' } }] } };

    const compressed = compressFeed(template, feedData);
    expect(compressed).toBeInstanceOf(Uint8Array);
    expect(compressed.length).toBeGreaterThan(0);

    // raw deflate を展開して msgpack デコード → f2a の結果と一致するか
    const inflated = inflateRaw(compressed);
    const decoded = msgpackDecode(inflated);
    expect(Array.isArray(decoded)).toBe(true);
    expect((decoded as any[]).length).toBe(15);
  });

  it('★元JS期待値: 先頭は fixarray(15) = 0x9f', () => {
    const template = ['shipment{}', ' service_type!'];
    const feedData = { feed: { entry: [{ shipment: { service_type: '0' } }] } };
    const compressed = compressFeed(template, feedData);
    const inflated = inflateRaw(compressed);
    // msgpack fixarray prefix: 0x9f (array size 15)
    expect(inflated[0]).toBe(0x9f);
  });
});
