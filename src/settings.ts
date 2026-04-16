/**
 * general_settings の取得・更新（プリンタ種別切替）
 *
 * ★設計書 4-1 / 5-3 / 5-3-3 参照★
 *
 * - GET /b2/p/settings → プリンタ設定取得
 * - PUT /b2/p/settings → プリンタ設定更新（★read-modify-write 必須）
 *
 * ★PUT は最小ペイロード不可、general_settings オブジェクト全体必須。
 *   欠落必須項目があると EF117002 / EF117003 / EF117004 エラー。
 *
 * ★printer_type はアカウント単位のグローバル設定。並列運用時は排他制御必須
 *   （5-3 参照、setPrinterType → print → restore を1リクエストで完結）。
 */

import { b2Get, b2Put } from './b2client';
import { createAndPrint, reprintFullFlow } from './print';
import type {
  B2Session,
  FeedEntry,
  PrinterType,
  GeneralSettings,
  OutputFormat,
  ServiceType,
  Shipment,
  PrintType,
} from './types';

// ============================================================
// settings API
// ============================================================

/**
 * プリンタ設定を取得（GET /b2/p/settings）
 */
export async function getSettings(
  session: B2Session
): Promise<FeedEntry<GeneralSettings>> {
  const res = await b2Get<GeneralSettings>(session, '/b2/p/settings');
  const entry = res.feed?.entry?.[0];
  if (!entry) {
    throw new Error('settings 取得失敗: entry なし');
  }
  return entry;
}

/**
 * プリンタ設定を更新（PUT /b2/p/settings、★read-modify-write）
 *
 * @param session
 * @param updater 現在の general_settings を受け取り、変更後のオブジェクトを返す関数
 */
export async function updateSettings(
  session: B2Session,
  updater: (current: GeneralSettings) => GeneralSettings
): Promise<FeedEntry<GeneralSettings>> {
  // Step 1: read
  const currentEntry = await getSettings(session);
  const current = (currentEntry as any).general_settings ?? currentEntry.shipment ?? {};

  // Step 2: modify
  const updated = updater(current as GeneralSettings);

  // Step 3: write（general_settings 全体を送信）
  const body = {
    feed: {
      entry: [
        {
          id: currentEntry.id,
          link: currentEntry.link,
          general_settings: updated,
        },
      ],
    },
  };

  const res = await b2Put<GeneralSettings>(session, '/b2/p/settings', body);
  return res.feed.entry?.[0] ?? currentEntry;
}

/**
 * プリンタ種別を切替（read-modify-write）
 *
 * @param session
 * @param value "1"=レーザー, "2"=インクジェット, "3"=ラベルプリンタ
 */
export async function setPrinterType(
  session: B2Session,
  value: PrinterType
): Promise<void> {
  await updateSettings(session, (current) => ({
    ...current,
    printer_type: value,
  }));
}

/**
 * 現在の printer_type を取得
 */
export async function getPrinterType(
  session: B2Session
): Promise<PrinterType | undefined> {
  const entry = await getSettings(session);
  const gs = (entry as any).general_settings ?? {};
  return gs.printer_type as PrinterType | undefined;
}

// ============================================================
// output_format × service_type → print_type 変換
// ============================================================

/**
 * service_type × format → print_type 変換表（★実機確定、設計書 5-3-2-B / 5-3-3）
 *
 * ★ラベル設定で印刷可能な service_type は限定的:
 *   - ✅ 0/2/4/7/A は全てラベル印刷可能
 *   - ❌ 3/5/8/9 はラベル印刷不可（全 print_type で 400 Error）
 */
export function selectPrintType(
  serviceType: ServiceType,
  format: OutputFormat
): PrintType {
  if (format === 'a5_multi') return 'm5';
  if (format === 'a4_multi') return 'm';

  // label (printer_type=3) 時は専用レイアウトを選ぶ
  const labelTable: Partial<Record<ServiceType, PrintType>> = {
    '0': '4', // 発払い → ラベル発払い (70KB, 119.6×236.1mm)
    '2': '2', // コレクト → ラベルコレクト
    '4': '4', // タイム → ラベル発払い
    '7': '7', // ゆうパケット → ラベル
    A: 'A', // ネコポス → ラベル
  };

  const pt = labelTable[serviceType];
  if (!pt) {
    throw new Error(
      `service_type=${serviceType} はラベルプリンタ印刷に対応していません` +
        `（DM(3)/着払い(5)/コンパクト(8)/コンパクトコレクト(9)はレーザー設定必須、設計書 5-3-2-B 参照）`
    );
  }
  return pt;
}

// ============================================================
// 高レベル: 出力フォーマット指定で自動切替 → 印刷 → 復元
// ============================================================

/**
 * 高レベル印刷 API（出力フォーマット指定、自動プリンタ種別切替）
 *
 * ★設計書 5-3-3 参照。`setPrinterType → print → restore` を 1 リクエストで完結。
 *
 * ★並列実行の注意: general_settings.printer_type はアカウント単位のグローバル設定。
 * 同時に複数フォーマットで印刷したい場合は排他制御（mutex 等）で直列化必須。
 *
 * @param session
 * @param shipment 伝票データ
 * @param format 出力フォーマット
 */
export async function printWithFormat(
  session: B2Session,
  shipment: Shipment,
  format: OutputFormat
): Promise<{
  trackingNumber: string;
  internalTracking: string;
  issueNo: string;
  pdf: Uint8Array;
  pdfSize: number;
  searchKey4: string;
}> {
  // label 非対応の service_type は事前に弾く（設計書 5-3-2-B）
  if (format === 'label' && ['3', '5', '8', '9'].includes(shipment.service_type)) {
    throw new Error(
      `service_type=${shipment.service_type} はラベル印刷非対応。` +
        `a4_multi または a5_multi を指定するか、伝票種別を変更してください。`
    );
  }

  // 現在設定を取得
  const origEntry = await getSettings(session);
  const origSettings = ((origEntry as any).general_settings ?? {}) as GeneralSettings;
  const origPrinterType = origSettings.printer_type;
  const targetPrinterType: PrinterType = format === 'label' ? '3' : '1';

  try {
    if (origPrinterType !== targetPrinterType) {
      await setPrinterType(session, targetPrinterType);
    }
    const printType = selectPrintType(shipment.service_type, format);
    const result = await createAndPrint(session, shipment, printType);
    return {
      trackingNumber: result.trackingNumber,
      internalTracking: result.internalTracking,
      issueNo: result.issueNo,
      pdf: result.pdf,
      pdfSize: result.pdfSize,
      searchKey4: result.searchKey4,
    };
  } finally {
    // ★元のプリンタ種別に必ず戻す
    if (origPrinterType && origPrinterType !== targetPrinterType) {
      try {
        await setPrinterType(session, origPrinterType);
      } catch {
        // 復元失敗はログのみ（呼び出し側に例外を伝播させない）
        // eslint-disable-next-line no-console
        console.warn('[printWithFormat] printer_type 復元に失敗しました');
      }
    }
  }
}

/**
 * 再印刷版（既発行伝票 → 出力フォーマット指定）
 */
export async function reprintWithFormat(
  session: B2Session,
  searchKey4OrTrackingNumber: string,
  format: OutputFormat,
  serviceType?: ServiceType
): Promise<{
  pdf: Uint8Array;
  pdfSize: number;
  issueNo: string;
}> {
  // label 時は service_type 必須（print_type 判定に使う）
  if (format === 'label' && !serviceType) {
    throw new Error(
      'reprintWithFormat: format=label の場合 service_type 必須（ラベル可否判定）'
    );
  }

  const origEntry = await getSettings(session);
  const origSettings = ((origEntry as any).general_settings ?? {}) as GeneralSettings;
  const origPrinterType = origSettings.printer_type;
  const targetPrinterType: PrinterType = format === 'label' ? '3' : '1';

  try {
    if (origPrinterType !== targetPrinterType) {
      await setPrinterType(session, targetPrinterType);
    }

    const printType =
      format === 'label' && serviceType
        ? selectPrintType(serviceType, format)
        : format === 'a5_multi'
          ? 'm5'
          : 'm';

    const result = await reprintFullFlow(session, searchKey4OrTrackingNumber, printType);
    return result;
  } finally {
    if (origPrinterType && origPrinterType !== targetPrinterType) {
      try {
        await setPrinterType(session, origPrinterType);
      } catch {
        // eslint-disable-next-line no-console
        console.warn('[reprintWithFormat] printer_type 復元に失敗しました');
      }
    }
  }
}
