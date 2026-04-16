/**
 * msgpack.ts テスト（単体テスト）
 *
 * ★設計書 2-3 参照
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
  encodeFeedAsMsgpack,
  FIELD_PATTERN,
  CONTROL_CODE,
  MSGPACK_HEADERS,
  JSON_HEADERS,
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
    expect(replaceControlCode(false)).toBe('false');
    expect(replaceControlCode(0)).toBe('0');
  });

  it.each([
    ['\x00', ''],
    ['\x01', ''],
    ['\x02', ''],
    ['\x03', ''],
    ['\x04', ''],
    ['\x05', ''],
    ['\x06', ''],
    ['\x07', ''],
    ['\x08', ''],
    ['\x0B', ''], // VT
    ['\x0C', ''], // FF
    ['\x0D', ''], // CR
    ['\x0E', ''], // SO
    ['\x0F', ''], // SI
    ['\x10', ''], // DLE
    ['\x11', ''],
    ['\x12', ''],
    ['\x13', ''],
    ['\x14', ''],
    ['\x15', ''],
    ['\x16', ''],
    ['\x17', ''],
    ['\x18', ''],
    ['\x19', ''],
    ['\x1A', ''],
    ['\x1B', ''],
    ['\x1C', ''],
    ['\x1D', ''],
    ['\x1E', ''],
    ['\x1F', ''],
    ['\x7F', ''],
  ])('制御文字 U+%s 単独は除去', (ch, expected) => {
    expect(replaceControlCode(ch)).toBe(expected);
  });

  it.each([
    ['\t', '\t'],
    ['\n', '\n'],
    [' ', ' '], // 0x20 スペース
    ['A', 'A'], // 0x41
    ['z', 'z'],
    ['!', '!'],
    ['あ', 'あ'],
    ['0', '0'],
    ['~', '~'], // 0x7E
  ])('通常文字 "%s" はそのまま', (ch, expected) => {
    expect(replaceControlCode(ch)).toBe(expected);
  });

  it('複数の制御文字を除去', () => {
    expect(replaceControlCode('a\x00b\x01c\x7Fd')).toBe('abcd');
  });

  it('連続する制御文字を除去', () => {
    expect(replaceControlCode('\x00\x01\x02abc')).toBe('abc');
    expect(replaceControlCode('abc\x00\x01\x02')).toBe('abc');
  });

  it('オブジェクトは String() 化', () => {
    expect(replaceControlCode({ a: 1 })).toBe('[object Object]');
  });

  it('配列は String() でカンマ結合', () => {
    expect(replaceControlCode([1, 2, 3])).toBe('1,2,3');
  });

  it('空文字はそのまま', () => {
    expect(replaceControlCode('')).toBe('');
  });
});

// ============================================================
// FIELD_PATTERN
// ============================================================

describe('FIELD_PATTERN', () => {
  it('単純フィールド', () => {
    const m = 'service_type'.match(FIELD_PATTERN);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('');
    expect(m![2]).toBe('service_type');
  });

  it('ネストフィールド（スペース1個）', () => {
    const m = ' name'.match(FIELD_PATTERN);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(' ');
    expect(m![2]).toBe('name');
  });

  it('ネストフィールド（スペース2個）', () => {
    const m = '  x'.match(FIELD_PATTERN);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('  ');
    expect(m![2]).toBe('x');
  });

  it('配列記法 {}', () => {
    const m = 'author{}'.match(FIELD_PATTERN);
    expect(m).not.toBeNull();
    expect(m![2]).toBe('author');
  });

  it('配列記法 []', () => {
    const m = 'items[]'.match(FIELD_PATTERN);
    expect(m).not.toBeNull();
    expect(m![2]).toBe('items');
  });

  it('配列サイズ [5]', () => {
    const m = 'arr[5]'.match(FIELD_PATTERN);
    expect(m).not.toBeNull();
    expect(m![2]).toBe('arr');
    expect(m![5]).toBe('5');
  });

  it('必須フラグ !', () => {
    const m = 'service_type!'.match(FIELD_PATTERN);
    expect(m).not.toBeNull();
    expect(m![2]).toBe('service_type');
    expect(m![8]).toBe('!');
  });

  it('型ヒント（letters のみ）', () => {
    const m = 'package_qty(rdbint)'.match(FIELD_PATTERN);
    expect(m).not.toBeNull();
    expect(m![2]).toBe('package_qty');
    expect(m![3]).toBe('rdbint');
  });

  it('デフォルト値', () => {
    const m = 'service_type=0'.match(FIELD_PATTERN);
    expect(m).not.toBeNull();
    expect(m![9]).toBe('0');
  });

  it('範囲 {~5}', () => {
    const m = 'qty{~5}'.match(FIELD_PATTERN);
    expect(m).not.toBeNull();
    expect(m![2]).toBe('qty');
    expect(m![7]).toBe('5');
  });

  it('範囲 {-5~5}', () => {
    const m = 'v{-5~5}'.match(FIELD_PATTERN);
    expect(m).not.toBeNull();
    expect(m![2]).toBe('v');
    expect(m![6]).toBe('-5');
    expect(m![7]).toBe('5');
  });

  it('ドット付きフィールド', () => {
    const m = 'foo.bar'.match(FIELD_PATTERN);
    expect(m).not.toBeNull();
    expect(m![2]).toBe('foo.bar');
  });

  it('数字を含むフィールド名（先頭は英字）', () => {
    const m = 'search_key4'.match(FIELD_PATTERN);
    expect(m).not.toBeNull();
    expect(m![2]).toBe('search_key4');
  });

  it('空行はマッチしない（先頭スペースのみ）', () => {
    expect(''.match(FIELD_PATTERN)).toBeNull();
    expect('  '.match(FIELD_PATTERN)).toBeNull();
  });

  it('先頭が数字だとマッチしない', () => {
    expect('123abc'.match(FIELD_PATTERN)).toBeNull();
  });

  it('アンダースコアから開始（元JS許容）', () => {
    const m = '_private'.match(FIELD_PATTERN);
    expect(m).not.toBeNull();
    expect(m![2]).toBe('_private');
  });

  it('$ から開始', () => {
    const m = '$var'.match(FIELD_PATTERN);
    expect(m).not.toBeNull();
    expect(m![2]).toBe('$var');
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
    expect('\t'.match(CONTROL_CODE)).toBeNull();
    expect('\n'.match(CONTROL_CODE)).toBeNull();
  });

  it('DEL (0x7F) にマッチ', () => {
    expect('\x7F'.match(CONTROL_CODE)).not.toBeNull();
  });

  it('通常文字にはマッチしない', () => {
    expect('A'.match(CONTROL_CODE)).toBeNull();
    expect(' '.match(CONTROL_CODE)).toBeNull();
    expect('あ'.match(CONTROL_CODE)).toBeNull();
  });

  it('global フラグ付き（連続マッチ）', () => {
    const matches = 'a\x00b\x01c'.match(CONTROL_CODE);
    expect(matches?.length).toBe(2);
  });
});

// ============================================================
// t2m
// ============================================================

describe('t2m', () => {
  it('プレフィックス + 独自 shipment 構造を正しくマッピング', () => {
    const template = ['shipment{}', ' service_type!', ' consignee_name'];
    const mapping = t2m(template);
    expect(mapping.entry.shipment).toBeDefined();
    expect(mapping.entry.shipment._[0]).toBe(16);
    expect(mapping.entry.shipment._[1]).toBe('shipment');
    expect((mapping.entry.shipment as any).service_type._[0]).toBe(0);
    expect((mapping.entry.shipment as any).consignee_name._[0]).toBe(1);
  });

  it('★author{} の子要素 (スペース付き) が正しく子扱いされる', () => {
    const mapping = t2m([]);
    expect((mapping.entry as any).author._[0]).toBe(0);
    const author = (mapping.entry as any).author;
    expect(author.name._[0]).toBe(0);
    expect(author.uri._[0]).toBe(1);
    expect(author.email._[0]).toBe(2);
  });

  it('プレフィックスには 16 トップレベル要素ある', () => {
    const mapping = t2m([]);
    const keys = Object.keys(mapping.entry);
    expect(keys).toContain('author');
    expect(keys).toContain('category');
    expect(keys).toContain('content');
    expect(keys).toContain('contributor');
    expect(keys).toContain('id');
    expect(keys).toContain('link');
    expect(keys).toContain('published');
    expect(keys).toContain('title');
    expect(keys).toContain('updated');
  });

  it('複数のトップレベルフィールド（shipment, customer）', () => {
    const template = [
      'shipment{}',
      ' service_type!',
      'customer{}',
      ' customer_code',
    ];
    const mapping = t2m(template);
    expect(mapping.entry.shipment._[0]).toBe(16);
    expect(mapping.entry.customer._[0]).toBe(17);
  });

  it('3段ネスト', () => {
    const template = [
      'outer{}',
      ' middle{}',
      '  inner!',
    ];
    const mapping = t2m(template);
    const outer = (mapping.entry as any).outer;
    expect(outer._[0]).toBe(16);
    expect(outer.middle._[0]).toBe(0);
    expect(outer.middle.inner._[0]).toBe(0);
  });

  it('空のテンプレート → プレフィックスのみ', () => {
    const mapping = t2m([]);
    expect(mapping.entry).toBeDefined();
    expect(Object.keys(mapping.entry).length).toBeGreaterThan(0);
  });

  it('category{} の子要素 (___term, ___scheme, ___label)', () => {
    const mapping = t2m([]);
    const category = (mapping.entry as any).category;
    expect(category.___term).toBeDefined();
    expect(category.___scheme).toBeDefined();
    expect(category.___label).toBeDefined();
  });

  it('link{} の子要素 (___href, ___rel, etc.)', () => {
    const mapping = t2m([]);
    const link = (mapping.entry as any).link;
    expect(link.___href).toBeDefined();
    expect(link.___rel).toBeDefined();
  });

  it('1フィールドのみのテンプレート', () => {
    const template = ['foo'];
    const mapping = t2m(template);
    expect((mapping.entry as any).foo._[0]).toBe(16);
    expect((mapping.entry as any).foo._[1]).toBe('foo');
  });

  it('! と {} の組み合わせ（必須配列）', () => {
    const template = ['items{}!', ' name!'];
    const mapping = t2m(template);
    const items = (mapping.entry as any).items;
    expect(items).toBeDefined();
    expect(items._[1]).toBe('items');
    expect(items.name._[0]).toBe(0);
  });

  it('インデント不整合の行はスキップ', () => {
    const template = [
      'shipment{}',
      '   badly_indented', // indent 3 は無視される（parent+1 のみ有効）
      ' service_type!',
    ];
    const mapping = t2m(template);
    expect((mapping.entry.shipment as any).service_type).toBeDefined();
  });
});

// ============================================================
// e2a
// ============================================================

describe('e2a', () => {
  it('スカラー値を配列化（shipment は idx=16）', () => {
    const template = ['shipment{}', ' service_type!'];
    const mapping = t2m(template);
    const arr = e2a(mapping, 'entry', { shipment: { service_type: '0' } });
    expect(arr[16]).toEqual(['0']);
  });

  it('制御文字を除去', () => {
    const template = ['shipment{}', ' service_type!', ' consignee_name'];
    const mapping = t2m(template);
    const arr = e2a(mapping, 'entry', {
      shipment: { service_type: '0', consignee_name: 'abc\x01def' },
    });
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

  it('欠損インデックスが null で埋まる', () => {
    const template = [
      'shipment{}',
      ' a',
      ' b',
      ' c',
      ' d',
    ];
    const mapping = t2m(template);
    const arr = e2a(mapping, 'entry', { shipment: { b: '2', d: '4' } });
    expect(arr[16]).toEqual([null, '2', null, '4']);
  });

  it('数値は文字列化される', () => {
    const template = ['shipment{}', ' count'];
    const mapping = t2m(template);
    const arr = e2a(mapping, 'entry', { shipment: { count: 42 } });
    expect(arr[16][0]).toBe('42');
  });

  it('真偽値は文字列化される', () => {
    const template = ['shipment{}', ' flg'];
    const mapping = t2m(template);
    const arr = e2a(mapping, 'entry', { shipment: { flg: true } });
    expect(arr[16][0]).toBe('true');
  });

  it('mapping にないフィールドはスキップ', () => {
    const template = ['shipment{}', ' service_type!'];
    const mapping = t2m(template);
    const arr = e2a(mapping, 'entry', {
      shipment: { service_type: '0', unknown_field: 'xxx' },
    });
    expect(arr[16]).toEqual(['0']);
  });

  it('空配列は無視', () => {
    const template = ['shipment{}', ' errors{}'];
    const mapping = t2m(template);
    const arr = e2a(mapping, 'entry', { shipment: { errors: [] } });
    // errors は空で処理されないので [null] になる
    expect(arr[16]).toEqual([null]);
  });

  it('keyMapping が見つからない場合は空配列', () => {
    const mapping = t2m([]);
    const arr = e2a(mapping, 'nonexistent', { foo: 'bar' });
    expect(arr).toEqual([]);
  });
});

// ============================================================
// f2a
// ============================================================

describe('f2a', () => {
  it('15要素配列、先頭13は null、[14] に entry 配列', () => {
    const template = ['shipment{}', ' service_type!'];
    const feedData = { feed: { entry: [{ shipment: { service_type: '0' } }] } };
    const arr = f2a(template, feedData);
    expect(arr.length).toBe(15);
    for (let i = 0; i < 13; i++) {
      expect(arr[i]).toBeNull();
    }
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

  it('feed.entry が空配列でも 15要素配列を返す', () => {
    const template = ['shipment{}'];
    const arr = f2a(template, { feed: { entry: [] } });
    expect(arr.length).toBe(15);
    expect(arr[14]).toEqual([]);
  });

  it('feed が undefined でもクラッシュしない', () => {
    const template = ['shipment{}'];
    const arr = f2a(template, {});
    expect(arr.length).toBe(15);
    expect(arr[14]).toEqual([]);
  });

  it('複数の entry を正しく処理', () => {
    const template = ['shipment{}', ' service_type!'];
    const feedData = {
      feed: {
        entry: [
          { shipment: { service_type: '0' } },
          { shipment: { service_type: '1' } },
          { shipment: { service_type: '2' } },
        ],
      },
    };
    const arr = f2a(template, feedData);
    expect(arr[14].length).toBe(3);
  });

  it('全てのインデックスが書き込まれるかパターン確認', () => {
    const template = ['shipment{}', ' service_type!'];
    const arr = f2a(template, { feed: {} });
    // indexes 0..12 → null, 13 undefined/null, 14 → []
    expect(arr[0]).toBeNull();
    expect(arr[12]).toBeNull();
    expect(arr[14]).toEqual([]);
  });
});

// ============================================================
// compressFeed / encodeFeedAsMsgpack
// ============================================================

describe('compressFeed', () => {
  it('出力は Uint8Array、inflateRaw で復元可能', () => {
    const template = ['shipment{}', ' service_type!'];
    const feedData = { feed: { entry: [{ shipment: { service_type: '0' } }] } };
    const compressed = compressFeed(template, feedData);
    expect(compressed).toBeInstanceOf(Uint8Array);
    expect(compressed.length).toBeGreaterThan(0);
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
    expect(inflated[0]).toBe(0x9f);
  });

  it('空 entry でも圧縮できる', () => {
    const template = ['shipment{}'];
    const compressed = compressFeed(template, { feed: { entry: [] } });
    expect(compressed.length).toBeGreaterThan(0);
  });

  it('大量データで圧縮効果が確認できる', () => {
    const template = ['shipment{}', ' consignee_name'];
    // 100件の同じデータ（圧縮効果が高い）
    const entries = Array.from({ length: 100 }, () => ({
      shipment: { consignee_name: 'テスト太郎' },
    }));
    const feedData = { feed: { entry: entries } };
    const compressed = compressFeed(template, feedData);
    const uncompressed = encodeFeedAsMsgpack(template, feedData);
    expect(compressed.length).toBeLessThan(uncompressed.length);
  });
});

describe('encodeFeedAsMsgpack', () => {
  it('raw msgpack を返す（zlib なし）', () => {
    const template = ['shipment{}', ' service_type!'];
    const feedData = { feed: { entry: [{ shipment: { service_type: '0' } }] } };
    const encoded = encodeFeedAsMsgpack(template, feedData);
    expect(encoded).toBeInstanceOf(Uint8Array);
    // 先頭は fixarray(15) = 0x9f
    expect(encoded[0]).toBe(0x9f);
    // デコード可能
    const decoded = msgpackDecode(encoded);
    expect(Array.isArray(decoded)).toBe(true);
  });
});

// ============================================================
// HTTPヘッダ定数
// ============================================================

describe('MSGPACK_HEADERS / JSON_HEADERS', () => {
  it('MSGPACK_HEADERS は Content-Type と Content-Encoding を持つ', () => {
    expect(MSGPACK_HEADERS['Content-Type']).toBe(
      'application/x-msgpack; charset=x-user-defined'
    );
    expect(MSGPACK_HEADERS['Content-Encoding']).toBe('deflate');
  });

  it('JSON_HEADERS は application/json', () => {
    expect(JSON_HEADERS['Content-Type']).toBe('application/json');
  });
});
