/**
 * E2E テスト共通セットアップ
 *
 * - .env をプロセス環境変数に読み込む
 * - 環境変数ガード判定ヘルパーをエクスポート
 */

import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// プロジェクト直下の .env を読む（無くても OK）
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  dotenvConfig({ path: envPath });
}

/**
 * 認証情報があるか
 */
export function hasCredentials(): boolean {
  return !!(process.env.B2_CUSTOMER_CODE && process.env.B2_CUSTOMER_PASSWORD);
}

/**
 * E2E テスト全般の有効化フラグ
 * `B2_E2E_ENABLED=1` がセットされていれば軽量 E2E (auth/check/save/delete) を実行
 */
export function isE2EEnabled(): boolean {
  return process.env.B2_E2E_ENABLED === '1' && hasCredentials();
}

/**
 * フル E2E（実印刷・実PDF取得・実追跡番号取得）の有効化フラグ
 * `B2_E2E_FULL=1` がセットされていれば実発行までする
 *
 * ★警告: B2クラウドに印刷ジョブが発行され 12桁追跡番号が払い出されます★
 */
export function isE2EFullEnabled(): boolean {
  return process.env.B2_E2E_FULL === '1' && hasCredentials();
}

/**
 * テスト用の安全なご依頼主（環境変数からの取得）
 * 設定されていない場合はテスト用デフォルト
 */
export function getTestShipper(): {
  shipper_telephone_display: string;
  shipper_zip_code: string;
  shipper_address1: string;
  shipper_address2: string;
  shipper_address3: string;
  shipper_name: string;
} {
  return {
    shipper_telephone_display:
      process.env.B2_TEST_SHIPPER_TEL ?? '03-1234-5678',
    shipper_zip_code: process.env.B2_TEST_SHIPPER_ZIP ?? '100-0001',
    shipper_address1: process.env.B2_TEST_SHIPPER_ADDR1 ?? '東京都',
    shipper_address2: process.env.B2_TEST_SHIPPER_ADDR2 ?? '千代田区',
    shipper_address3: process.env.B2_TEST_SHIPPER_ADDR3 ?? '千代田1-1',
    shipper_name: process.env.B2_TEST_SHIPPER_NAME ?? 'E2Eテスト依頼主',
  };
}

/**
 * テスト用のお届け先（環境変数からの取得）
 * 既定値は架空のテスト住所
 *
 * ★注意: 実発行 (B2_E2E_FULL=1) する場合、ここに実在の宛先を入れると
 *   実際に伝票が発行されます。検証用には環境変数で「自社住所」など
 *   無害な宛先に上書きしてください
 */
export function getTestConsignee(): {
  consignee_telephone_display: string;
  consignee_zip_code: string;
  consignee_address1: string;
  consignee_address2: string;
  consignee_address3: string;
  consignee_name: string;
} {
  return {
    consignee_telephone_display:
      process.env.B2_TEST_CONSIGNEE_TEL ?? '03-9999-9999',
    consignee_zip_code: process.env.B2_TEST_CONSIGNEE_ZIP ?? '100-0014',
    consignee_address1: process.env.B2_TEST_CONSIGNEE_ADDR1 ?? '東京都',
    consignee_address2: process.env.B2_TEST_CONSIGNEE_ADDR2 ?? '千代田区',
    consignee_address3: process.env.B2_TEST_CONSIGNEE_ADDR3 ?? '永田町1-7-1',
    consignee_name: process.env.B2_TEST_CONSIGNEE_NAME ?? 'E2Eテスト宛先',
  };
}

/**
 * 請求先設定（発払い時に必須）
 * デフォルトは認証アカウントと同じ顧客コード
 */
export function getTestInvoice(): {
  invoice_code: string;
  invoice_code_ext: string;
  invoice_freight_no: string;
  invoice_name: string;
} {
  return {
    invoice_code: process.env.B2_TEST_INVOICE_CODE ?? process.env.B2_CUSTOMER_CODE ?? '',
    invoice_code_ext: '', // ★必ず空文字（設計書 6章）
    invoice_freight_no: process.env.B2_TEST_INVOICE_FREIGHT_NO ?? '01',
    invoice_name: '',
  };
}

/**
 * 出荷予定日（明日）"YYYY/MM/DD"
 */
export function tomorrowDate(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}
