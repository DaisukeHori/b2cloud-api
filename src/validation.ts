/**
 * リクエスト入力バリデーション（Zod）
 *
 * ★設計書 6章・9-2 参照★
 *
 * - API エンドポイント / MCP ツールで使う入力スキーマを Zod で定義
 * - サーバー側の checkonly が本丸のバリデーションなので、ここでは型・必須・長さの
 *   一次チェックのみ（早期フィードバック用）
 */

import { z } from 'zod';
import type { Shipment } from './types';

// ============================================================
// 基本スキーマ
// ============================================================

export const serviceTypeSchema = z.enum([
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'A',
]);

export const printTypeSchema = z.enum([
  'm',
  'm5',
  '0',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'A',
  'CP',
]);

export const printerTypeSchema = z.enum(['1', '2', '3']);

export const outputFormatSchema = z.enum(['a4_multi', 'a5_multi', 'label']);

// ============================================================
// 共通: 入力の正規化ヘルパー
// ============================================================

/**
 * "YYYY/MM/DD" | "YYYYMMDD" | Date を "YYYY/MM/DD" に正規化
 */
export function normalizeShipmentDate(input: string | Date | undefined): string {
  if (!input) {
    // デフォルト: 本日
    const d = new Date();
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  }
  if (input instanceof Date) {
    return `${input.getFullYear()}/${String(input.getMonth() + 1).padStart(2, '0')}/${String(input.getDate()).padStart(2, '0')}`;
  }
  if (/^\d{8}$/.test(input)) {
    // YYYYMMDD → YYYY/MM/DD
    return `${input.slice(0, 4)}/${input.slice(4, 6)}/${input.slice(6, 8)}`;
  }
  return input;
}

// ============================================================
// Shipment 入力スキーマ（9-2 MCP create_and_print_shipment の入力に対応）
// ============================================================

/**
 * MCP / REST 入力の Shipment（一部フィールドを自動補完）
 */
export const shipmentInputSchema = z.object({
  // 必須
  service_type: serviceTypeSchema,
  consignee_name: z.string().min(1).max(32), // 最大全角16=バイト32
  consignee_telephone_display: z.string().min(1).max(15),
  consignee_zip_code: z.string().min(1).max(8),

  // 住所: 一括指定 or 個別指定のどちらかが必要（後続で検証）
  consignee_address: z.string().optional(),
  consignee_address1: z.string().max(10).optional(),
  consignee_address2: z.string().max(24).optional(),
  consignee_address3: z.string().max(32).optional(),
  consignee_address4: z.string().max(32).optional(),
  consignee_department1: z.string().max(50).optional(),
  consignee_department2: z.string().max(50).optional(),
  consignee_title: z.enum(['様', '御中', '']).optional(),
  consignee_name_kana: z.string().max(50).optional(),
  consignee_code: z.string().optional(),
  consignee_telephone_ext: z.string().max(2).optional(),

  // 品名（DM(3) 以外必須）
  item_name1: z.string().max(50).optional(),
  item_code1: z.string().max(30).optional(),
  item_name2: z.string().max(50).optional(),
  item_code2: z.string().max(30).optional(),

  // 出荷関連
  shipment_date: z.string().optional(), // normalizeShipmentDate で正規化
  is_cool: z.enum(['0', '1', '2']).default('0'),
  package_qty: z.string().default('1'),
  delivery_time_zone: z.string().default('0000'),
  short_delivery_date_flag: z.enum(['0', '1']).default('1'),
  is_printing_date: z.enum(['0', '1']).default('1'),
  is_printing_lot: z.enum(['1', '2', '3']).default('2'),
  is_agent: z.enum(['0', '1']).default('0'),
  payment_flg: z.string().default('0'),
  is_using_center_service: z.enum(['0', '1']).default('0'),
  consignee_center_code: z.string().optional(),
  is_using_shipment_email: z.enum(['0', '1']).default('0'),
  is_using_delivery_email: z.enum(['0', '1']).default('0'),
  shipment_email_address: z.string().optional(),
  shipment_message: z.string().optional(),
  delivery_email_address: z.string().optional(),
  delivery_message: z.string().optional(),
  delivery_date: z.string().optional(),

  // 請求先（着払い時は不要、それ以外は invoice_code 必須）
  invoice_code: z.string().optional(),
  invoice_code_ext: z.string().default(''),
  invoice_freight_no: z.string().optional(),
  invoice_name: z.string().optional(),

  // ご依頼主（省略可、環境変数でデフォルト）
  shipper_name: z.string().max(32).optional(),
  shipper_telephone_display: z.string().max(15).optional(),
  shipper_telephone_ext: z.string().max(2).optional(),
  shipper_zip_code: z.string().max(8).optional(),
  shipper_address1: z.string().max(10).optional(),
  shipper_address2: z.string().max(24).optional(),
  shipper_address3: z.string().max(32).optional(),
  shipper_address4: z.string().max(32).optional(),
  shipper_address: z.string().optional(),
  shipper_name_kana: z.string().max(50).optional(),

  // コレクト
  amount: z.string().optional(),
  tax_amount: z.string().optional(),

  // 複数口
  closure_key: z.string().optional(),

  // 荷扱い・備考
  handling_information1: z.string().max(20).optional(),
  handling_information2: z.string().max(20).optional(),
  note: z.string().max(44).optional(),

  // 検索キー
  search_key_title1: z.string().max(20).optional(),
  search_key1: z
    .string()
    .max(16)
    .regex(/^[A-Za-z0-9 ]*$/, '英数字・スペースのみ')
    .optional(),
  search_key_title2: z.string().max(20).optional(),
  search_key2: z
    .string()
    .max(16)
    .regex(/^[A-Za-z0-9 ]*$/, '英数字・スペースのみ')
    .optional(),
  search_key_title3: z.string().max(20).optional(),
  search_key3: z
    .string()
    .max(16)
    .regex(/^[A-Za-z0-9 ]*$/, '英数字・スペースのみ')
    .optional(),
  search_key_title4: z.string().max(20).optional(),
  search_key4: z
    .string()
    .max(16)
    .regex(/^[A-Za-z0-9 ]*$/, '英数字・スペースのみ')
    .optional(),

  // 収納代行 12項目
  agent_amount: z.string().optional(),
  agent_tax_amount: z.string().optional(),
  agent_invoice_zip_code: z.string().optional(),
  agent_invoice_address2: z.string().optional(),
  agent_invoice_address3: z.string().optional(),
  agent_invoice_name: z.string().optional(),
  agent_invoice_kana: z.string().optional(),
  agent_request_name: z.string().optional(),
  agent_request_zip_code: z.string().optional(),
  agent_request_address2: z.string().optional(),
  agent_request_address3: z.string().optional(),
  agent_request_telephone: z.string().optional(),
});

export type ShipmentInput = z.infer<typeof shipmentInputSchema>;

// ============================================================
// 入力 → Shipment 変換
// ============================================================

/**
 * 環境変数のデフォルトご依頼主情報
 */
export interface DefaultShipperConfig {
  shipper_name?: string;
  shipper_telephone_display?: string;
  shipper_zip_code?: string;
  shipper_address1?: string;
  shipper_address2?: string;
  shipper_address3?: string;
  shipper_address4?: string;
  invoice_code?: string;
  invoice_code_ext?: string;
  invoice_freight_no?: string;
}

/**
 * 環境変数から DefaultShipperConfig を取得
 */
export function getDefaultShipperFromEnv(): DefaultShipperConfig {
  return {
    shipper_name: process.env.B2_DEFAULT_SHIPPER_NAME,
    shipper_telephone_display: process.env.B2_DEFAULT_SHIPPER_TEL,
    shipper_zip_code: process.env.B2_DEFAULT_SHIPPER_ZIP,
    shipper_address1: process.env.B2_DEFAULT_SHIPPER_ADDR1,
    shipper_address2: process.env.B2_DEFAULT_SHIPPER_ADDR2,
    shipper_address3: process.env.B2_DEFAULT_SHIPPER_ADDR3,
    invoice_code: process.env.B2_DEFAULT_INVOICE_CODE,
    invoice_code_ext: process.env.B2_DEFAULT_INVOICE_CODE_EXT ?? '',
    invoice_freight_no: process.env.B2_DEFAULT_INVOICE_FREIGHT_NO ?? '01',
  };
}

/**
 * Zod 検証済み入力 → Shipment（デフォルト値適用、住所自動分割）
 *
 * @param input shipmentInputSchema.parse() の結果
 * @param defaults 環境変数由来のデフォルト値
 */
export function inputToShipment(
  input: ShipmentInput,
  defaults: DefaultShipperConfig = {}
): Shipment {
  const shipment: Shipment = {
    // 必須
    service_type: input.service_type,
    shipment_date: normalizeShipmentDate(input.shipment_date),
    is_cool: input.is_cool,
    short_delivery_date_flag: input.short_delivery_date_flag,
    is_printing_date: input.is_printing_date,
    delivery_time_zone: input.delivery_time_zone,
    package_qty: input.package_qty,
    is_printing_lot: input.is_printing_lot,
    payment_flg: input.payment_flg,
    is_agent: input.is_agent,

    // 請求先（着払い(5) 時は空でも OK、それ以外は必須）
    invoice_code: input.invoice_code ?? defaults.invoice_code ?? '',
    invoice_code_ext: input.invoice_code_ext ?? defaults.invoice_code_ext ?? '',
    invoice_freight_no:
      input.invoice_freight_no ?? defaults.invoice_freight_no ?? '01',
    invoice_name: input.invoice_name ?? '',

    // お届け先
    consignee_telephone_display: input.consignee_telephone_display,
    consignee_zip_code: input.consignee_zip_code,
    consignee_address1: input.consignee_address1 ?? '',
    consignee_address2: input.consignee_address2 ?? '',
    consignee_address3: input.consignee_address3 ?? '',
    consignee_name: input.consignee_name,
    consignee_title: input.consignee_title ?? '様',
    is_using_center_service: input.is_using_center_service,
    is_using_shipment_email: input.is_using_shipment_email,
    is_using_delivery_email: input.is_using_delivery_email,

    // ご依頼主（入力なければデフォルト）
    shipper_telephone_display:
      input.shipper_telephone_display ?? defaults.shipper_telephone_display ?? '',
    shipper_zip_code: input.shipper_zip_code ?? defaults.shipper_zip_code ?? '',
    shipper_address1: input.shipper_address1 ?? defaults.shipper_address1 ?? '',
    shipper_address2: input.shipper_address2 ?? defaults.shipper_address2 ?? '',
    shipper_address3: input.shipper_address3 ?? defaults.shipper_address3 ?? '',
    shipper_name: input.shipper_name ?? defaults.shipper_name ?? '',
  };

  // オプショナルフィールドをコピー
  const copyFields: (keyof ShipmentInput)[] = [
    'consignee_address4',
    'consignee_address',
    'consignee_department1',
    'consignee_department2',
    'consignee_name_kana',
    'consignee_code',
    'consignee_telephone_ext',
    'consignee_center_code',
    'item_name1',
    'item_code1',
    'item_name2',
    'item_code2',
    'handling_information1',
    'handling_information2',
    'note',
    'shipment_email_address',
    'shipment_message',
    'delivery_email_address',
    'delivery_message',
    'delivery_date',
    'shipper_telephone_ext',
    'shipper_address4',
    'shipper_address',
    'shipper_name_kana',
    'amount',
    'tax_amount',
    'closure_key',
    'search_key_title1',
    'search_key1',
    'search_key_title2',
    'search_key2',
    'search_key_title3',
    'search_key3',
    'search_key_title4',
    'search_key4',
    'agent_amount',
    'agent_tax_amount',
    'agent_invoice_zip_code',
    'agent_invoice_address2',
    'agent_invoice_address3',
    'agent_invoice_name',
    'agent_invoice_kana',
    'agent_request_name',
    'agent_request_zip_code',
    'agent_request_address2',
    'agent_request_address3',
    'agent_request_telephone',
  ];

  for (const key of copyFields) {
    const v = input[key];
    if (v !== undefined && v !== '') {
      (shipment as any)[key] = v;
    }
  }

  return shipment;
}

// ============================================================
// 履歴検索入力
// ============================================================

export const historySearchSchema = z.object({
  tracking_number: z.string().optional(),
  search_key4: z.string().optional(),
  service_type: serviceTypeSchema.optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
});

// ============================================================
// 再印刷入力
// ============================================================

export const reprintSchema = z.object({
  tracking_number: z.string().min(1),
  print_type: printTypeSchema.optional(),
  output_format: outputFormatSchema.optional(),
});

// ============================================================
// 削除入力
// ============================================================

export const deleteSavedSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

// ============================================================
// プリンタ設定入力
// ============================================================

export const setPrinterTypeSchema = z.object({
  printer_type: printerTypeSchema,
});
