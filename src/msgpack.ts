/**
 * B2クラウド msgpack+zlib 圧縮パイプライン
 *
 * ★元JSからの直接移植（main-9d4c7b2348.js）★
 *
 * このファイルは B2クラウドの `main-9d4c7b2348.js`（single_issue_reg.html用、398KB）
 * に含まれる以下の関数を TypeScript に忠実に移植したもの:
 *
 *   - f2a(mapping, feedData)      : feed全体を配列に変換
 *   - e2a(mapping, key, entry)    : entry を再帰的に配列化
 *   - t2m(templateLines)          : テンプレート文字列 → マッピング辞書
 *   - t2m2(lines, startIdx, path) : t2m の再帰ヘルパー
 *   - replaceControlCode(value)   : 制御文字除去
 *
 * 定数:
 *   - FIELD_PATTERN   : フィールド定義パース用正規表現
 *   - CONTROL_CODE    : 制御文字範囲 (0x00-0x1F + 0x7F)
 *
 * ★ワイヤーフォーマット（実機検証済み）:
 *   JSON 585B → msgpack 418B → raw deflate 205B（65%削減）
 *
 *   HTTPヘッダ:
 *     Content-Type: application/x-msgpack; charset=x-user-defined
 *     Content-Encoding: deflate
 *
 *   バイト列構造:
 *     先頭: 9f c0 c0 ... (fixarray 15要素、最初14要素はnull)
 *     末尾: entry配列 (fixarray + フィールド配列)
 *
 * ★pako.deflateRaw の注意:
 *   元JSの `zlib_asm.compress` は zlib 形式（ヘッダ2byte + フッタ4byte）を生成し、
 *   `subarray(2, -4)` で除去して raw deflate にしている。
 *   pako の `deflateRaw` は最初から raw 形式で出力するため、除去処理は不要。
 *
 * @see https://github.com/DaisukeHori/b2cloud-api/blob/main/docs/verification-results.md
 */

import { encode as msgpackEncode } from '@msgpack/msgpack';
import { deflateRaw } from 'pako';

// ============================================================
// 定数（元JSから抽出）
// ============================================================

/**
 * フィールド定義パース用正規表現（元JS原文ママ）
 *
 * キャプチャグループ:
 *   $1 = 先頭スペース（階層レベル判定用）
 *   $2 = フィールド名
 *   $3 = 型ヒント（rdb_double / rdb_int / rdb_date / rdb_ignore 等）
 *   $4 = 配列記法全体
 *   $5 = 配列サイズ
 *   $6 = 数値範囲min
 *   $7 = 数値範囲max
 *   $8 = 必須フラグ（'!'）
 *   $9 = デフォルト値
 */
export const FIELD_PATTERN =
  /^( *)([a-zA-Z_$][0-9a-zA-Z_$.]*)(?:\(([a-zA-Z$]+)\))?((?:\[([0-9]+)?\]|\{([\-0-9]*)~?([\-0-9]+)?\})?)(\!?)(?:=(.+))?$/;

/**
 * 制御文字範囲（元JS原文ママ）
 * - 0x00-0x08: NUL～BS
 * - 0x0B-0x0F: VT～SI
 * - 0x10-0x1F: DLE～US
 * - 0x1A-0x1E: SUB～RS（重複）
 * - 0x7F    : DEL
 *
 * 注意: \t (0x09), \n (0x0A) は含まない（許容される制御文字）
 */
export const CONTROL_CODE =
  /[\x00-\x08\x0b\x0c\x0d\x0e\x0f\x1a\x1b\x1c\x1d\x1e\x1f\x10-\x19\x7f]/g;

// ============================================================
// 型定義
// ============================================================

/**
 * テンプレートマッピング構造
 * t2m() の返り値。フィールド名をインデックスに変換するための階層辞書
 *
 * ★設計注記: `_` キーは「自分自身」のメタ情報（idx + path）で、
 * それ以外のキーは子フィールド（FieldMappingEntry）。元JS 実装の動的構造に準拠するため
 * 型定義は any ベースで記述する（strict index 型と相容れないため）。
 */
export type FieldMappingEntry = {
  /** [配列インデックス, ドット区切りパス] の2要素配列 */
  _: [number, string];
} & {
  [fieldName: string]: any;
};

export interface FieldMapping {
  [fieldName: string]: FieldMappingEntry;
}

/** t2m が返す最上位構造 */
export interface TemplateMapping {
  entry: FieldMapping;
}

// ============================================================
// 関数移植
// ============================================================

/**
 * 制御文字を除去する（元JS: B2GLOBAL.replaceControlCode）
 *
 * ```javascript
 * // 元JS:
 * B2GLOBAL.replaceControlCode = function(e) {
 *   return void 0 === e || null === e ? "" : e.replace(new RegExp(CONTROL_CODE), "")
 * };
 * ```
 *
 * @param value 任意の値
 * @returns 制御文字を除去した文字列（undefined/nullは空文字）
 */
export function replaceControlCode(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).replace(CONTROL_CODE, '');
}

/**
 * テンプレートの各行から階層レベル（先頭スペース数）を取得
 */
function getIndent(line: string): number {
  const m = line.match(FIELD_PATTERN);
  if (!m) return 0;
  return m[1]?.length ?? 0;
}

/**
 * テンプレートの各行からフィールド名を取得
 */
function getFieldName(line: string): string {
  const m = line.match(FIELD_PATTERN);
  if (!m) return '';
  return m[2] ?? '';
}

/**
 * t2m2 - t2m の再帰ヘルパー（元JS原文の忠実移植）
 *
 * ```javascript
 * // 元JS:
 * function t2m2(e, t, _) {
 *   var n = {},
 *       i = e[t].replace(FIELD_PATTERN, "$2"),
 *       r = e[t].replace(FIELD_PATTERN, "$1").length,
 *       a = 0,
 *       s = e.length;
 *   n[i] = {};
 *   for (var o = t + 1; o < s; o++) {
 *     var E = e[o].replace(FIELD_PATTERN, "$2"),
 *         l = e[o].replace(FIELD_PATTERN, "$1").length;
 *     if (l == r + 1) {
 *       var c = _ + "." + e[o].replace(/^\s+|\[\]|{}|\s+$/g, "");
 *       n[i][E] = t2m2(e, o, _)[E];
 *       n[i][E]._ = [];
 *       n[i][E]._[0] = a;
 *       n[i][E]._[1] = c;
 *       a++
 *     } else if (l <= r) {
 *       return n
 *     }
 *   }
 *   return n
 * }
 * ```
 *
 * @param lines テンプレート行配列
 * @param startIdx 開始インデックス
 * @param path 親パス（例: "entry.shipment"）
 */
function t2m2(
  lines: string[],
  startIdx: number,
  path: string
): Record<string, FieldMappingEntry> {
  const result: Record<string, any> = {};
  const parentName = getFieldName(lines[startIdx]);
  const parentIndent = getIndent(lines[startIdx]);
  let childIndex = 0;

  result[parentName] = {};

  for (let i = startIdx + 1; i < lines.length; i++) {
    const childName = getFieldName(lines[i]);
    const childIndent = getIndent(lines[i]);

    if (childIndent === parentIndent + 1) {
      // 直接の子要素
      const cleanedLine = lines[i].replace(/^\s+|\[\]|\{\}|\s+$/g, '');
      const fullPath = path + '.' + cleanedLine;

      // 再帰的に子の子孫を処理
      const sub = t2m2(lines, i, fullPath);
      result[parentName][childName] = sub[childName];
      result[parentName][childName]._ = [childIndex, fullPath];
      childIndex++;
    } else if (childIndent <= parentIndent) {
      // 兄弟または祖先レベルに戻ったので終了
      return result;
    }
  }

  return result;
}

/**
 * t2m - テンプレート文字列配列 → マッピング辞書（元JS原文の忠実移植）
 *
 * 元JSの先頭32要素の固定プレフィックスを必ず含める。これは author/id/link/etc の
 * 予約フィールド定義で、テンプレート固有のフィールドはその後ろに追加される。
 *
 * ```javascript
 * // 元JS:
 * function t2m(e) {
 *   for (var t = ["author{}", "name", "uri", "email", "category{}", " ___term", ...],
 *        _ = t, n = 0; n < e.length; n++)
 *     e[n].length > 0 && _.push(e[n]);
 *
 *   for (var i = {entry: {}}, r = 0, n = 0; n < _.length; n++) {
 *     var a = _[n].replace(FIELD_PATTERN, "$2"),
 *         s = _[n].replace(FIELD_PATTERN, "$1").length,
 *         o = _[n].replace(/^\s+|\[\]|{}|!|\s+$/g, "");
 *     if (0 == s) {
 *       i.entry[a] = t2m2(_, n, o)[a];
 *       i.entry[a]._ = [];
 *       i.entry[a]._[0] = r;
 *       i.entry[a]._[1] = o;
 *       r++
 *     }
 *   }
 *   return i
 * }
 * ```
 *
 * @param templateLines /b2/d/_settings/template から取得した1115行の配列
 * @returns マッピング辞書（entry.shipment.service_type._ = [0, "shipment.service_type"] 等）
 */
export function t2m(templateLines: string[]): TemplateMapping {
  // 元JS固定プレフィックス（32要素、AtomフィードのRFC4287標準フィールド）
  const prefix = [
    'author{}',
    ' name',
    ' uri',
    ' email',
    'category{}',
    ' ___term',
    ' ___scheme',
    ' ___label',
    'content',
    ' ___src',
    ' ___type',
    ' ______text',
    'contributor{}',
    ' name',
    ' uri',
    ' email',
    'id',
    'link{}',
    ' ___href',
    ' ___rel',
    ' ___type',
    ' ___title',
    ' ___length',
    'published',
    'rights',
    'rights____type',
    'summary',
    'summary____type',
    'title',
    'title____type',
    'subtitle',
    'subtitle____type',
    'updated',
  ];

  const allLines = [...prefix];
  for (const line of templateLines) {
    if (line.length > 0) allLines.push(line);
  }

  const mapping: TemplateMapping = { entry: {} };
  let topLevelIndex = 0;

  for (let i = 0; i < allLines.length; i++) {
    const fieldName = getFieldName(allLines[i]);
    const indent = getIndent(allLines[i]);
    const cleanedPath = allLines[i].replace(/^\s+|\[\]|\{\}|!|\s+$/g, '');

    if (indent === 0 && fieldName) {
      // トップレベルフィールド
      const sub = t2m2(allLines, i, cleanedPath);
      mapping.entry[fieldName] = sub[fieldName];
      mapping.entry[fieldName]._ = [topLevelIndex, cleanedPath];
      topLevelIndex++;
    }
  }

  return mapping;
}

/**
 * e2a - entry を再帰的に配列化（元JS原文の忠実移植）
 *
 * ```javascript
 * // 元JS:
 * function e2a(e, t, _) {
 *   var n = [];
 *   for (var i in _)
 *     if ("object" == typeof _[i])
 *       if ("undefined" != typeof _[i].length && _[i].length) {
 *         // 配列
 *         for (var r = [], a = 0; a < _[i].length; a++)
 *           r[a] = e2a(e[t], i, _[i][a]);
 *         n[e[t][i]._[0]] = r
 *       } else {
 *         // ネストオブジェクト
 *         n[e[t][i]._[0]] = e2a(e[t], i, _[i])
 *       }
 *     else
 *       e[t][i] && (void 0 != _[i]
 *         ? n[e[t][i]._[0]] = B2GLOBAL.replaceControlCode(_[i])
 *         : n[e[t][i]._[0]] = "");
 *
 *   // 欠損インデックスを null で埋める
 *   var a = 0;
 *   for (var s in e[t])
 *     "_" != s && (void 0 == n[a] && (n[a] = null), a++);
 *   return n
 * }
 * ```
 *
 * @param parentMapping 親マッピング (mapping や mapping[parentKey])
 * @param key 現在処理中のキー名 (例: "entry", "shipment")
 * @param entryData 変換対象のオブジェクト
 * @returns 配列化された結果
 */
export function e2a(
  parentMapping: any,
  key: string,
  entryData: any
): any[] {
  const result: any[] = [];
  const keyMapping = parentMapping[key];

  if (!keyMapping) {
    // マッピングに該当キーがない場合はそのまま値を返す（型ヒントなし扱い）
    return result;
  }

  for (const fieldName in entryData) {
    const value = entryData[fieldName];
    const fieldMap = keyMapping[fieldName];

    if (!fieldMap) continue; // マッピング辞書にないフィールドはスキップ

    const idx = fieldMap._[0];

    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value) && value.length > 0) {
        // 配列: 各要素を再帰的に変換
        const arr: any[] = [];
        for (let a = 0; a < value.length; a++) {
          arr[a] = e2a(keyMapping, fieldName, value[a]);
        }
        result[idx] = arr;
      } else if (!Array.isArray(value)) {
        // ネストオブジェクト
        result[idx] = e2a(keyMapping, fieldName, value);
      }
      // 空配列は無視（元JSの挙動）
    } else {
      // スカラー値
      if (value !== undefined) {
        result[idx] = replaceControlCode(value);
      } else {
        result[idx] = '';
      }
    }
  }

  // 欠損インデックスを null で埋める（固定長配列化）
  let a = 0;
  for (const fieldName in keyMapping) {
    if (fieldName === '_') continue;
    if (result[a] === undefined) result[a] = null;
    a++;
  }

  return result;
}

/**
 * f2a - feed全体を配列に変換（元JS原文の忠実移植）
 *
 * ```javascript
 * // 元JS:
 * function f2a(e, t) {
 *   for (var _ = [], n = 0; n < 15; n++) _[n] = null;
 *   var i = t2m(e);
 *   _[14] = [];
 *   for (var n = 0; n < t.feed.entry.length; n++)
 *     _[14][n] = e2a(i, "entry", t.feed.entry[n]);
 *   return "updated" in t.feed && (_[13] = t.feed.updated), _
 * }
 * ```
 *
 * @param templateLines /b2/d/_settings/template の中身
 * @param feedData { feed: { entry: [...] } } 形式のデータ
 * @returns 15要素配列（先頭14個null、[14]がentry配列、`updated`があれば[13]）
 */
export function f2a(templateLines: string[], feedData: any): any[] {
  // 15要素の null 配列を作成
  const result: any[] = new Array(15).fill(null);

  const mapping = t2m(templateLines);

  // [14] = entry配列
  result[14] = [];
  const entries = feedData?.feed?.entry ?? [];
  for (let n = 0; n < entries.length; n++) {
    result[14][n] = e2a(mapping, 'entry', entries[n]);
  }

  // 'updated' が存在すれば [13] に設定
  if (feedData?.feed && 'updated' in feedData.feed) {
    result[13] = feedData.feed.updated;
  }

  return result;
}

// ============================================================
// 高レベル API
// ============================================================

/**
 * feed データを msgpack+zlib で圧縮
 *
 * 元JSの処理:
 * ```javascript
 * var s = this.template;
 * var o = f2a(s, e.data);                             // feed → 配列
 * var E = zlib_asm.compress(msgpack.encode(o));        // msgpack → zlib
 * var _ = new Uint8Array(E.subarray(2, E.length - 4)); // zlib ヘッダ/フッタ除去
 * xhr.send(_);
 * ```
 *
 * pako.deflateRaw は最初から raw 形式を出力するため subarray 除去は不要。
 *
 * @param templateLines テンプレート行配列
 * @param feedData { feed: { entry: [...] } }
 * @returns raw deflate 圧縮済み Uint8Array
 */
export function compressFeed(
  templateLines: string[],
  feedData: any
): Uint8Array {
  const array = f2a(templateLines, feedData);
  const packed = msgpackEncode(array);
  // pako.deflateRaw: 出力は raw deflate (zlib ヘッダ/フッタなし)
  return deflateRaw(packed);
}

/**
 * msgpack のみ（zlib なし）で feed を圧縮
 * デバッグ・テスト用
 */
export function encodeFeedAsMsgpack(
  templateLines: string[],
  feedData: any
): Uint8Array {
  const array = f2a(templateLines, feedData);
  return msgpackEncode(array);
}

// ============================================================
// HTTP ヘッダ定数
// ============================================================

/**
 * msgpack+zlib 送信時の必須ヘッダ
 */
export const MSGPACK_HEADERS = {
  'Content-Type': 'application/x-msgpack; charset=x-user-defined',
  'Content-Encoding': 'deflate',
} as const;

/**
 * JSON 送信時のヘッダ（フォールバック用）
 */
export const JSON_HEADERS = {
  'Content-Type': 'application/json',
} as const;
