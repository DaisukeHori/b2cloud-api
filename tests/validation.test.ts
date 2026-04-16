/**
 * validation.ts テスト
 *
 * ★設計書 6章 参照（バリデーションルール）
 */

import { describe, it, expect } from 'vitest';
import {
  shipmentInputSchema,
  normalizeShipmentDate,
  inputToShipment,
  historySearchSchema,
  setPrinterTypeSchema,
} from '../src/validation';

describe('normalizeShipmentDate', () => {
  it('undefined → 本日の YYYY/MM/DD', () => {
    const s = normalizeShipmentDate(undefined);
    expect(/^\d{4}\/\d{2}\/\d{2}$/.test(s)).toBe(true);
  });

  it('YYYYMMDD → YYYY/MM/DD', () => {
    expect(normalizeShipmentDate('20260420')).toBe('2026/04/20');
  });

  it('YYYY/MM/DD はそのまま', () => {
    expect(normalizeShipmentDate('2026/04/20')).toBe('2026/04/20');
  });

  it('Date → YYYY/MM/DD', () => {
    const d = new Date('2026-04-20T00:00:00Z');
    const s = normalizeShipmentDate(d);
    expect(/^2026\/04\/\d{2}$/.test(s)).toBe(true);
  });
});

describe('shipmentInputSchema', () => {
  const validInput = {
    service_type: '0' as const,
    consignee_name: 'テスト太郎',
    consignee_telephone_display: '03-1234-5678',
    consignee_zip_code: '100-0001',
    consignee_address1: '東京都',
    consignee_address2: '千代田区',
    consignee_address3: '千代田1-1',
  };

  it('最小構成で valid', () => {
    const r = shipmentInputSchema.parse(validInput);
    expect(r.service_type).toBe('0');
    expect(r.package_qty).toBe('1'); // デフォルト
    expect(r.is_cool).toBe('0'); // デフォルト
  });

  it('consignee_name 必須', () => {
    expect(() =>
      shipmentInputSchema.parse({
        ...validInput,
        consignee_name: '',
      })
    ).toThrow();
  });

  it('search_key4: 16文字以内の英数字のみ（設計書 E-5 #16-a）', () => {
    expect(() =>
      shipmentInputSchema.parse({
        ...validInput,
        search_key4: 'ABC123',
      })
    ).not.toThrow();

    // 17文字 → NG
    expect(() =>
      shipmentInputSchema.parse({
        ...validInput,
        search_key4: 'A'.repeat(17),
      })
    ).toThrow();

    // アンダースコア → NG
    expect(() =>
      shipmentInputSchema.parse({
        ...validInput,
        search_key4: 'abc_123',
      })
    ).toThrow();
  });
});

describe('inputToShipment', () => {
  const validInput = {
    service_type: '0' as const,
    consignee_name: 'テスト太郎',
    consignee_telephone_display: '03-1234-5678',
    consignee_zip_code: '100-0001',
    consignee_address1: '東京都',
    consignee_address2: '千代田区',
    consignee_address3: '千代田1-1',
  };

  it('デフォルト値を適用し Shipment に変換', () => {
    const parsed = shipmentInputSchema.parse(validInput);
    const ship = inputToShipment(parsed, {
      shipper_name: '株式会社テスト',
      shipper_zip_code: '100-0000',
      shipper_address1: '東京都',
      shipper_address2: '港区',
      shipper_address3: '六本木1-1',
      shipper_telephone_display: '03-0000-0000',
      invoice_code: '0482540070',
      invoice_code_ext: '',
      invoice_freight_no: '01',
    });
    expect(ship.service_type).toBe('0');
    expect(ship.shipper_name).toBe('株式会社テスト');
    expect(ship.invoice_code).toBe('0482540070');
    expect(ship.invoice_code_ext).toBe(''); // ★設計書 F-6: 空文字が正解
    expect(ship.invoice_freight_no).toBe('01'); // ★枝番はここ
    expect(ship.consignee_title).toBe('様'); // デフォルト
  });

  it('入力値がデフォルトより優先される', () => {
    const parsed = shipmentInputSchema.parse({
      ...validInput,
      shipper_name: '株式会社上書き',
    });
    const ship = inputToShipment(parsed, {
      shipper_name: '株式会社デフォルト',
    });
    expect(ship.shipper_name).toBe('株式会社上書き');
  });

  it('オプションフィールド（search_key4 等）がコピーされる', () => {
    const parsed = shipmentInputSchema.parse({
      ...validInput,
      search_key4: 'TEST12345',
      search_key_title4: 'API',
    });
    const ship = inputToShipment(parsed);
    expect(ship.search_key4).toBe('TEST12345');
    expect(ship.search_key_title4).toBe('API');
  });
});

describe('historySearchSchema', () => {
  it('全フィールド optional', () => {
    expect(() => historySearchSchema.parse({})).not.toThrow();
  });

  it('service_type が enum', () => {
    expect(() => historySearchSchema.parse({ service_type: 'X' })).toThrow();
    expect(() =>
      historySearchSchema.parse({ service_type: '0' })
    ).not.toThrow();
  });
});

describe('setPrinterTypeSchema', () => {
  it('printer_type は "1"/"2"/"3" のみ', () => {
    expect(() =>
      setPrinterTypeSchema.parse({ printer_type: '1' })
    ).not.toThrow();
    expect(() =>
      setPrinterTypeSchema.parse({ printer_type: '3' })
    ).not.toThrow();
    expect(() =>
      setPrinterTypeSchema.parse({ printer_type: '4' })
    ).toThrow();
  });
});
