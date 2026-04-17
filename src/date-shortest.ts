/**
 * 最短配達スロット選定ロジック
 *
 * service_type × is_cool から date API のどの行を参照するかを決定し、
 * 最短の (deliveryDate, deliveryTimeZone) を返す。
 *
 * @see docs/date-feature-design_v2.md §5
 */

import {
  searchDeliveryDate,
  EARLIEST_TIME_ZONE_BY_CONSTRAINT,
  TIME_ZONE_CODES_BY_CONSTRAINT,
  type DateSearchResult,
  type TimeZoneConstraint,
  type ProductDeliveryInfo,
  DateApiError,
} from './date';
import { getTodayJST } from './date-utils';

// ============================================================
// 型定義
// ============================================================

export type DateApiRow = 'takkyubin' | 'compactCool';
export type SupportedServiceType = '0' | '2' | '5' | '6' | '8' | '9';

export interface FindShortestInput {
  shipperZipCode: string;
  consigneeZipCode: string;
  searchKbn?: 'shipment';
  serviceType?: SupportedServiceType;
  isCool?: '0' | '1' | '2';
  shipmentDate?: string;
}

export interface FindShortestOutput {
  shipmentDate: string;
  deliveryDate: string;
  deliveryTimeZone: string;
  usedRow: DateApiRow;
  constraint: TimeZoneConstraint;
  constraintJp: string;
  coolAvailable: boolean;
  rationale: string;
  estimatedArrival: string;
  alternatives: Array<{ deliveryTimeZone: string; label: string }>;
  warnings: string[];
  raw: DateSearchResult;
}

// ============================================================
// 行選択ロジック
// ============================================================

export function selectRow(
  serviceType: SupportedServiceType,
  isCool: '0' | '1' | '2'
): DateApiRow {
  // 宅急便コンパクト系は常に compactCool 行
  if (serviceType === '8' || serviceType === '9') return 'compactCool';
  // 通常宅急便で is_cool != '0' は compactCool 行（クール情報を見る）
  if (isCool !== '0') return 'compactCool';
  // それ以外は takkyubin 行
  return 'takkyubin';
}

// ============================================================
// 時間帯ラベル
// ============================================================

const TIME_ZONE_LABELS: Record<string, string> = {
  '0812': '午前中(08-12時)',
  '1416': '14時-16時',
  '1618': '16時-18時',
  '1820': '18時-20時',
  '1921': '19時-21時',
  '0000': '指定なし',
};

// ============================================================
// メイン関数
// ============================================================

export async function findShortestDeliverySlot(
  input: FindShortestInput
): Promise<FindShortestOutput> {
  const serviceType = input.serviceType ?? '0';
  const isCool = input.isCool ?? '0';
  const shipmentDate = input.shipmentDate?.replace(/\//g, '-') ?? getTodayJST();

  // 1. date API を呼ぶ
  const rawResult = await searchDeliveryDate({
    shipperZipCode: input.shipperZipCode,
    consigneeZipCode: input.consigneeZipCode,
    date: shipmentDate,
    searchKbn: input.searchKbn ?? 'shipment',
  });

  return buildShortestFromResult(rawResult, serviceType, isCool, shipmentDate);
}

export function buildShortestFromResult(
  rawResult: DateSearchResult,
  serviceType: SupportedServiceType,
  isCool: '0' | '1' | '2',
  shipmentDate: string
): FindShortestOutput {
  // 2. 行選択
  const usedRow = selectRow(serviceType, isCool);

  // 3. 行データ取得
  const rowData: ProductDeliveryInfo & { coolAvailable?: boolean } =
    usedRow === 'takkyubin' ? rawResult.takkyubin : rawResult.compactCool;

  // 4. クール不可チェック
  const coolAvailable = 'coolAvailable' in rowData ? rowData.coolAvailable !== false : true;
  if (usedRow === 'compactCool' && isCool !== '0' && !coolAvailable) {
    throw new DateApiError(
      `このエリア(${rawResult.consigneeZipCode})はヤマトのクール宅急便取扱対象外です。` +
        `他社便(佐川急便のクール便等)をご検討ください。`,
      'COOL_UNAVAILABLE',
      400
    );
  }

  // 5. 最短時間帯を採用
  const constraint = rowData.constraint;
  const deliveryTimeZone = EARLIEST_TIME_ZONE_BY_CONSTRAINT[constraint] ?? '0000';

  // 6. rationale 生成
  const deliveryDate = rowData.deliveryDate.replace(/-/g, '/');
  const shipmentDateSlash = shipmentDate.replace(/-/g, '/');
  const rationale =
    `発地 ${rawResult.shipperZipCode} → 着地 ${rawResult.consigneeZipCode}、` +
    `出荷 ${shipmentDateSlash}、着日 ${deliveryDate}、` +
    `時間帯 ${TIME_ZONE_LABELS[deliveryTimeZone] ?? deliveryTimeZone}`;

  // 7. estimatedArrival 算出
  const timeMap: Record<string, string> = {
    '0812': '08:00',
    '1416': '14:00',
    '1618': '16:00',
    '1820': '18:00',
    '1921': '19:00',
    '0000': '00:00',
  };
  const timeStr = timeMap[deliveryTimeZone] ?? '00:00';
  const estimatedArrival = `${rowData.deliveryDate}T${timeStr}:00+09:00`;

  // 8. alternatives
  const allCodes = TIME_ZONE_CODES_BY_CONSTRAINT[constraint] ?? [];
  const alternatives = allCodes
    .filter((c) => c !== deliveryTimeZone)
    .slice(0, 3)
    .map((c) => ({ deliveryTimeZone: c, label: TIME_ZONE_LABELS[c] ?? c }));

  // 9. warnings
  const warnings: string[] = [];
  if (rowData.notice) warnings.push(rowData.notice);
  if (constraint === 'not_specifiable') {
    warnings.push('この地域は時間帯指定ができません');
  }

  return {
    shipmentDate: shipmentDateSlash,
    deliveryDate,
    deliveryTimeZone,
    usedRow,
    constraint,
    constraintJp: rowData.constraintJp,
    coolAvailable,
    rationale,
    estimatedArrival,
    alternatives,
    warnings,
    raw: rawResult,
  };
}
