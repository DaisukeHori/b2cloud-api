/**
 * ヤマト運輸 配達予定日検索 API クライアント
 *
 * date.kuronekoyamato.co.jp の裏 API をスクレイピングし、
 * 発地/着地/出荷日から配達予定日と時間帯制約を構造化 JSON で返す。
 *
 * @see docs/date-feature-design_v2.md §2, §4
 */

import { parseDocument } from 'htmlparser2';
import * as cssSelect from 'css-select';
import { textContent } from 'domutils';
import { getTodayJST } from './date-utils';

// ============================================================
// 型定義
// ============================================================

/** 時間帯制約の正規化済み値 */
export type TimeZoneConstraint =
  | 'morning_ok'
  | 'afternoon_only'
  | 'evening_only'
  | 'not_specifiable'
  | 'not_applicable';

/** 時間帯制約 → 有効な delivery_time_zone 配列 */
export const TIME_ZONE_CODES_BY_CONSTRAINT: Record<TimeZoneConstraint, string[]> = {
  morning_ok: ['0812', '1416', '1618', '1820', '1921'],
  afternoon_only: ['1416', '1618', '1820', '1921'],
  evening_only: ['1820', '1921'],
  not_specifiable: ['0000'],
  not_applicable: [],
};

/** 時間帯制約 → 「真の最短」時間帯コード */
export const EARLIEST_TIME_ZONE_BY_CONSTRAINT: Record<TimeZoneConstraint, string | null> = {
  morning_ok: '0812',
  afternoon_only: '1416',
  evening_only: '1820',
  not_specifiable: '0000',
  not_applicable: null,
};

/** 入力: 配達予定日検索 */
export interface DateSearchInput {
  shipperZipCode: string;
  consigneeZipCode: string;
  searchKbn?: 'shipment';
  date?: string;
}

/** 1商品あたりの配達情報 */
export interface ProductDeliveryInfo {
  deliveryDate: string;
  deliveryDateJp: string;
  constraint: TimeZoneConstraint;
  constraintJp: string;
  notice?: string;
}

/** 出力: 配達予定日検索(4商品分) */
export interface DateSearchResult {
  shipperZipCode: string;
  consigneeZipCode: string;
  shipmentDate: string;
  takkyubin: ProductDeliveryInfo;
  compactCool: ProductDeliveryInfo & { coolAvailable: boolean };
  skiGolf: ProductDeliveryInfo;
  airport: ProductDeliveryInfo;
  globalNotices: string[];
  rawHtml?: string;
}

// ============================================================
// エラー
// ============================================================

export class DateApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = 'DateApiError';
  }
}

export class ParseError extends DateApiError {
  constructor(message: string, code: string = 'PARSE_ERROR') {
    super(message, code);
    this.name = 'ParseError';
  }
}

// ============================================================
// 定数
// ============================================================

const DATE_API_URL = 'https://date.kuronekoyamato.co.jp/date/Takkyubin';
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DATE_API_TIMEOUT_MS = 15000;

// ============================================================
// Cookie 取得（都度新規）
// ============================================================

interface DateSession {
  cookie: string;
}

async function getSession(ua: string, timeoutMs: number): Promise<DateSession> {
  const res = await fetch(DATE_API_URL, {
    method: 'GET',
    headers: { 'User-Agent': ua },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const parts: string[] = [];
  for (const c of setCookies) {
    const kv = c.split(';')[0];
    if (kv) parts.push(kv);
  }
  return { cookie: parts.join('; ') };
}

// ============================================================
// HTML 取得 + Shift_JIS デコード
// ============================================================

function normalizeZip(zip: string): string {
  return zip.replace(/[-ー－]/g, '').replace(/\s/g, '');
}

function buildFormBody(input: DateSearchInput, shipmentDate: string): string {
  const [y, m, d] = shipmentDate.split('-');
  const params = new URLSearchParams({
    ACTID: 'J_RKTKJS0010',
    PARA_STA: normalizeZip(input.shipperZipCode),
    PARA_END: normalizeZip(input.consigneeZipCode),
    PARA_YEAR: y,
    PARA_MONTH: String(parseInt(m, 10)),
    PARA_DAY: String(parseInt(d, 10)),
    PARA_SEARCH_KBN: 'PARA_DELIVERY_SEARCH',
    'BTN_EXEC_SLEVEL.x': '10',
    'BTN_EXEC_SLEVEL.y': '10',
  });
  return params.toString();
}

async function fetchDateHtml(
  input: DateSearchInput,
  shipmentDate: string,
  ua: string,
  timeoutMs: number
): Promise<string> {
  const session = await getSession(ua, timeoutMs);
  const body = buildFormBody(input, shipmentDate);
  const res = await fetch(DATE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=WINDOWS-31J',
      Referer: DATE_API_URL,
      Origin: 'https://date.kuronekoyamato.co.jp',
      'User-Agent': ua,
      Cookie: session.cookie,
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new DateApiError(
      `date API responded ${res.status} ${res.statusText}`,
      'UPSTREAM_ERROR',
      502
    );
  }
  const buf = await res.arrayBuffer();
  return new TextDecoder('shift-jis').decode(buf);
}

// ============================================================
// HTML パーサ
// ============================================================

function normalizeTimeZone(jp: string): TimeZoneConstraint {
  const s = jp.trim().replace(/\s+/g, '');
  if (s.includes('午前中から')) return 'morning_ok';
  if (s.includes('14時から') || s.includes('１４時から')) return 'afternoon_only';
  if (s.includes('18時から') || s.includes('１８時から')) return 'evening_only';
  if (s.includes('指定出来ません') || s.includes('指定できません')) return 'not_specifiable';
  if (s === '－' || s === '-' || s === '' || s === '―') return 'not_applicable';
  throw new ParseError(`未知の時間帯表現: "${jp}"`, 'UNKNOWN_TIME_ZONE_PHRASE');
}

function extractDateJp(text: string): { dateStr: string; dateJp: string } {
  // "2026年04月18日(金)" → { dateStr: "2026-04-18", dateJp: "2026年04月18日" }
  const m = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!m) throw new ParseError(`日付パース失敗: "${text}"`, 'DATE_PARSE_ERROR');
  const dateStr = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const dateJp = `${m[1]}年${m[2].padStart(2, '0')}月${m[3].padStart(2, '0')}日`;
  return { dateStr, dateJp };
}

function extractNotice(text: string): string | undefined {
  // "＊クール宅急便のお取扱いは出来ません。" 等の赤字注記
  const m = text.match(/[＊*](.+)/);
  return m ? m[1].trim() : undefined;
}

export function parseDateSearchHtml(
  html: string
): Omit<DateSearchResult, 'shipperZipCode' | 'consigneeZipCode' | 'shipmentDate'> {
  const doc = parseDocument(html);

  // テーブル行を全て取得
  const allTrs = cssSelect.selectAll('tr', doc);
  const rows: Array<{ cells: string[] }> = [];
  for (const tr of allTrs) {
    const tds = cssSelect.selectAll('td, th', tr);
    if (tds.length >= 2) {
      rows.push({ cells: tds.map((td) => textContent(td).trim()) });
    }
  }

  // 宅急便メインテーブル: "お届け予定日" と "お届け時間帯" のヘッダーを持つテーブルの直後の行
  let takkyubinDate = '';
  let takkyubinTimeJp = '';
  let foundMainHeader = false;
  for (const row of rows) {
    if (
      row.cells.some((c) => c.includes('お届け予定日')) &&
      row.cells.some((c) => c.includes('お届け時間帯'))
    ) {
      foundMainHeader = true;
      continue;
    }
    if (foundMainHeader && row.cells.length >= 2) {
      takkyubinDate = row.cells[0];
      takkyubinTimeJp = row.cells[1];
      foundMainHeader = false;
      break;
    }
  }

  // その他商品テーブル: "商品名" ヘッダーの後に3行
  const otherRows: Array<{ product: string; date: string; time: string }> = [];
  let foundOtherHeader = false;
  for (const row of rows) {
    if (row.cells.some((c) => c.includes('商品名'))) {
      foundOtherHeader = true;
      continue;
    }
    if (foundOtherHeader && row.cells.length >= 3) {
      otherRows.push({
        product: row.cells[0],
        date: row.cells[1],
        time: row.cells[2],
      });
      if (otherRows.length >= 3) break;
    }
  }

  // パース: 宅急便
  const takkyubinParsed = extractDateJp(takkyubinDate);
  const takkyubin: ProductDeliveryInfo = {
    deliveryDate: takkyubinParsed.dateStr,
    deliveryDateJp: takkyubinParsed.dateJp,
    constraint: normalizeTimeZone(takkyubinTimeJp),
    constraintJp: takkyubinTimeJp,
  };

  // パース: コンパクト・クール
  const compactRow = otherRows[0] ?? { product: '', date: '', time: '' };
  const compactParsed = extractDateJp(compactRow.date);
  const compactNotice = extractNotice(compactRow.date);
  const compactCool: ProductDeliveryInfo & { coolAvailable: boolean } = {
    deliveryDate: compactParsed.dateStr,
    deliveryDateJp: compactParsed.dateJp,
    constraint: normalizeTimeZone(compactRow.time),
    constraintJp: compactRow.time,
    notice: compactNotice,
    coolAvailable: !compactRow.date.includes('お取扱いは出来ません'),
  };

  // パース: スキー・ゴルフ
  const skiRow = otherRows[1] ?? { product: '', date: '', time: '' };
  let skiGolf: ProductDeliveryInfo;
  try {
    const skiParsed = extractDateJp(skiRow.date);
    skiGolf = {
      deliveryDate: skiParsed.dateStr,
      deliveryDateJp: skiParsed.dateJp,
      constraint: normalizeTimeZone(skiRow.time),
      constraintJp: skiRow.time,
      notice: extractNotice(skiRow.date),
    };
  } catch {
    skiGolf = {
      deliveryDate: '',
      deliveryDateJp: skiRow.date,
      constraint: 'not_applicable',
      constraintJp: skiRow.time || '－',
    };
  }

  // パース: 空港宅急便
  const airRow = otherRows[2] ?? { product: '', date: '', time: '' };
  let airport: ProductDeliveryInfo;
  try {
    const airParsed = extractDateJp(airRow.date);
    airport = {
      deliveryDate: airParsed.dateStr,
      deliveryDateJp: airParsed.dateJp,
      constraint: normalizeTimeZone(airRow.time),
      constraintJp: airRow.time,
      notice: extractNotice(airRow.date),
    };
  } catch {
    airport = {
      deliveryDate: '',
      deliveryDateJp: airRow.date,
      constraint: 'not_applicable',
      constraintJp: airRow.time || '－',
    };
  }

  // 全体注意事項
  const globalNotices: string[] = [];
  const noticeElements = cssSelect.selectAll('.attention, .fc-red', doc);
  for (const el of noticeElements) {
    const t = textContent(el).trim();
    if (t && t.length > 5) globalNotices.push(t);
  }

  return { takkyubin, compactCool, skiGolf, airport, globalNotices };
}

// ============================================================
// メイン関数
// ============================================================

export async function searchDeliveryDate(
  input: DateSearchInput,
  options?: {
    includeRawHtml?: boolean;
    userAgent?: string;
    timeoutMs?: number;
  }
): Promise<DateSearchResult> {
  const ua = options?.userAgent ?? DEFAULT_UA;
  const timeoutMs = options?.timeoutMs ?? DATE_API_TIMEOUT_MS;

  // 日付の正規化
  let shipmentDate = input.date ?? getTodayJST();
  shipmentDate = shipmentDate.replace(/\//g, '-');

  const html = await fetchDateHtml(input, shipmentDate, ua, timeoutMs);
  const parsed = parseDateSearchHtml(html);

  const result: DateSearchResult = {
    shipperZipCode: normalizeZip(input.shipperZipCode),
    consigneeZipCode: normalizeZip(input.consigneeZipCode),
    shipmentDate,
    ...parsed,
  };

  // rawHtml は本番モードでは無視
  if (options?.includeRawHtml && process.env.NODE_ENV !== 'production') {
    result.rawHtml = html;
  }

  return result;
}
