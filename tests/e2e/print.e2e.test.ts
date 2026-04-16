/**
 * E2E: フル印刷フロー（★実発行★）
 *
 * ★★★ 警告 ★★★
 * このテストは B2クラウドに実際に印刷ジョブを発行し、12桁追跡番号を払い出します。
 * 実行には B2_E2E_FULL=1 が必須です。誤実行を防ぐため二段ガード:
 *   1. B2_CUSTOMER_CODE / B2_CUSTOMER_PASSWORD 必須
 *   2. B2_E2E_FULL=1 必須
 *
 * 検証項目（設計書 4-7 / 4-8 / E-5）:
 * - createAndPrint() のフル E2E が完走 (約 20秒)
 * - issue_no が UMIN 形式
 * - PDF が valid (%PDF ヘッダ)
 * - 12桁 tracking_number が取得できる
 * - polling Success までの試行回数が妥当
 * - reprint (再印刷) で同じ伝票がもう一度 PDF 化できる
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { login, resolveLoginConfig } from '../../src/auth';
import { createAndPrint, reprintFullFlow } from '../../src/print';
import { generateUniqueKey, isValidPdf } from '../../src/b2client';
import type { B2Session, Shipment } from '../../src/types';
import {
  isE2EFullEnabled,
  getTestShipper,
  getTestConsignee,
  getTestInvoice,
  tomorrowDate,
} from './setup';

describe.skipIf(!isE2EFullEnabled())(
  'E2E: フル印刷フロー (★実発行★)',
  () => {
    let session: B2Session;
    const searchKey4 = generateUniqueKey('E2EF'); // E2E Full
    let issuedTrackingNumber = '';

    function buildTestShipment(): Shipment {
      return {
        service_type: '0', // 発払い
        shipment_date: tomorrowDate(),
        is_cool: '0',
        short_delivery_date_flag: '1',
        is_printing_date: '0',
        delivery_time_zone: '0000',
        package_qty: '1',
        is_printing_lot: '2',
        payment_flg: '0',
        is_agent: '0',
        is_using_center_service: '0',
        is_using_shipment_email: '0',
        is_using_delivery_email: '0',
        ...getTestInvoice(),
        ...getTestConsignee(),
        consignee_title: '様',
        ...getTestShipper(),
        item_name1: 'E2E full test',
        item_code1: 'E2EF001',
        search_key_title4: 'E2EFull',
        search_key4: searchKey4,
      };
    }

    beforeAll(async () => {
      session = await login(resolveLoginConfig({}));
    }, 30_000);

    it('createAndPrint() で 発行 → PDF → 追跡番号取得まで完走', async () => {
      const result = await createAndPrint(session, buildTestShipment());

      // issue_no が UMIN 形式
      expect(result.issueNo).toMatch(/^UMIN\d+$/);

      // 内部管理番号 (UMN形式)
      expect(result.internalTracking).toMatch(/^UMN\d+$/);

      // PDF が valid
      expect(isValidPdf(result.pdf)).toBe(true);
      expect(result.pdfSize).toBeGreaterThan(10_000); // 10KB 以上ある

      // 12桁 tracking_number が取得できる (リトライ前提なので時間かかる)
      expect(result.trackingNumber).toMatch(/^\d{12}$/);
      expect(result.trackingAttempts).toBeGreaterThan(0);
      expect(result.trackingAttempts).toBeLessThan(30); // 30回リトライ以内

      // polling は数回で Success
      expect(result.pollingAttempts).toBeGreaterThan(0);
      expect(result.pollingAttempts).toBeLessThan(40);

      // search_key4 が設定したものと一致
      expect(result.searchKey4).toBe(searchKey4);

      // 後続テストで再印刷を行うため保持
      issuedTrackingNumber = result.trackingNumber;

      // 進捗を見えるように出力
      console.log(`[E2E] issued: tracking=${result.trackingNumber}, ` +
        `pdfSize=${result.pdfSize}B, ` +
        `polling=${result.pollingAttempts}, ` +
        `tracking=${result.trackingAttempts}`);
    }, 90_000);

    it('reprintFullFlow() で同じ伝票を再印刷できる (12桁追跡番号で検索)', async () => {
      expect(issuedTrackingNumber).toMatch(/^\d{12}$/);

      const result = await reprintFullFlow(session, issuedTrackingNumber);

      expect(result.issueNo).toMatch(/^UMIN\d+$/);
      expect(isValidPdf(result.pdf)).toBe(true);
      expect(result.pdfSize).toBeGreaterThan(10_000);
      expect(result.pollingAttempts).toBeGreaterThan(0);

      console.log(`[E2E] reprint: pdfSize=${result.pdfSize}B, ` +
        `polling=${result.pollingAttempts}`);
    }, 60_000);

    it('reprintFullFlow() で search_key4 でも再印刷できる', async () => {
      const result = await reprintFullFlow(session, searchKey4);

      expect(result.issueNo).toMatch(/^UMIN\d+$/);
      expect(isValidPdf(result.pdf)).toBe(true);
    }, 60_000);
  }
);

describe.skipIf(isE2EFullEnabled())('E2E フル スキップ理由', () => {
  it('B2_E2E_FULL=1 が無いためスキップ (実発行を避けるための安全装置)', () => {
    expect(true).toBe(true);
  });
});
