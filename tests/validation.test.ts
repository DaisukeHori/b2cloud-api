/**
 * validation.ts テスト（単体テスト）
 *
 * ★設計書 6章 参照（バリデーションルール）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  shipmentInputSchema,
  normalizeShipmentDate,
  inputToShipment,
  historySearchSchema,
  setPrinterTypeSchema,
  reprintSchema,
  deleteSavedSchema,
  serviceTypeSchema,
  printTypeSchema,
  printerTypeSchema,
  outputFormatSchema,
  getDefaultShipperFromEnv,
} from '../src/validation';

// ============================================================
// normalizeShipmentDate
// ============================================================

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

  it.each([
    ['20260101', '2026/01/01'],
    ['20261231', '2026/12/31'],
    ['20200229', '2020/02/29'],
    ['20000101', '2000/01/01'],
    ['21001231', '2100/12/31'],
  ])('YYYYMMDD %s → %s', (input, expected) => {
    expect(normalizeShipmentDate(input)).toBe(expected);
  });

  it.each([
    ['2026/01/01'],
    ['2026-04-20'], // 非 YYYYMMDD 形式はそのまま
    ['2026/4/20'],
  ])('非 YYYYMMDD 入力はそのまま: %s', (input) => {
    expect(normalizeShipmentDate(input)).toBe(input);
  });

  it('Date で月が一桁でもゼロ埋め', () => {
    const d = new Date(2026, 0, 5); // 2026-01-05（ローカル）
    expect(normalizeShipmentDate(d)).toBe('2026/01/05');
  });

  it('empty string 入力は本日', () => {
    const s = normalizeShipmentDate('');
    expect(/^\d{4}\/\d{2}\/\d{2}$/.test(s)).toBe(true);
  });
});

// ============================================================
// shipmentInputSchema - 必須/任意フィールド
// ============================================================

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

  it('全デフォルト値が適用される', () => {
    const r = shipmentInputSchema.parse(validInput);
    expect(r.is_cool).toBe('0');
    expect(r.package_qty).toBe('1');
    expect(r.delivery_time_zone).toBe('0000');
    expect(r.short_delivery_date_flag).toBe('1');
    expect(r.is_printing_date).toBe('1');
    expect(r.is_printing_lot).toBe('2');
    expect(r.is_agent).toBe('0');
    expect(r.payment_flg).toBe('0');
    expect(r.is_using_center_service).toBe('0');
    expect(r.is_using_shipment_email).toBe('0');
    expect(r.is_using_delivery_email).toBe('0');
    expect(r.invoice_code_ext).toBe('');
  });

  it('consignee_name 必須', () => {
    expect(() =>
      shipmentInputSchema.parse({ ...validInput, consignee_name: '' })
    ).toThrow();
  });

  it('consignee_telephone_display 必須', () => {
    expect(() =>
      shipmentInputSchema.parse({ ...validInput, consignee_telephone_display: '' })
    ).toThrow();
  });

  it('consignee_zip_code 必須', () => {
    expect(() =>
      shipmentInputSchema.parse({ ...validInput, consignee_zip_code: '' })
    ).toThrow();
  });

  it('consignee_name: 33文字(全角16超) → NG', () => {
    expect(() =>
      shipmentInputSchema.parse({ ...validInput, consignee_name: 'あ'.repeat(33) })
    ).toThrow();
  });

  it('consignee_name: 32文字 → OK', () => {
    expect(() =>
      shipmentInputSchema.parse({ ...validInput, consignee_name: 'A'.repeat(32) })
    ).not.toThrow();
  });

  it('consignee_zip_code: 8文字超 → NG', () => {
    expect(() =>
      shipmentInputSchema.parse({ ...validInput, consignee_zip_code: '123456789' })
    ).toThrow();
  });

  it.each(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A'])(
    'service_type=%s OK',
    (st) => {
      expect(() =>
        shipmentInputSchema.parse({ ...validInput, service_type: st as any })
      ).not.toThrow();
    }
  );

  it.each(['', 'X', 'B', 'Z', '10'])(
    'service_type=%s NG',
    (st) => {
      expect(() =>
        shipmentInputSchema.parse({ ...validInput, service_type: st as any })
      ).toThrow();
    }
  );

  it.each(['0', '1', '2'])('is_cool=%s OK', (c) => {
    expect(() =>
      shipmentInputSchema.parse({ ...validInput, is_cool: c as any })
    ).not.toThrow();
  });

  it.each(['3', 'X', ''])('is_cool=%s NG', (c) => {
    expect(() =>
      shipmentInputSchema.parse({ ...validInput, is_cool: c as any })
    ).toThrow();
  });

  it.each(['様', '御中', ''])('consignee_title=%s OK', (t) => {
    expect(() =>
      shipmentInputSchema.parse({ ...validInput, consignee_title: t as any })
    ).not.toThrow();
  });

  it('consignee_title=殿 NG', () => {
    expect(() =>
      shipmentInputSchema.parse({ ...validInput, consignee_title: '殿' as any })
    ).toThrow();
  });

  // search_key4 バリデーション（★設計書 E-5 #16-a）
  it('search_key4: 16文字以内の英数字のみ', () => {
    expect(() =>
      shipmentInputSchema.parse({ ...validInput, search_key4: 'ABC123' })
    ).not.toThrow();
  });

  it('search_key4: 17文字 → NG', () => {
    expect(() =>
      shipmentInputSchema.parse({ ...validInput, search_key4: 'A'.repeat(17) })
    ).toThrow();
  });

  it.each(['abc_123', 'abc-def', 'abc.def', 'abc/def', 'あいう', 'abc@def'])(
    'search_key4 に無効文字 %s → NG',
    (v) => {
      expect(() =>
        shipmentInputSchema.parse({ ...validInput, search_key4: v })
      ).toThrow();
    }
  );

  it.each(['ABC', 'abc', '1234567890', 'A'.repeat(16), 'Test123 45'])(
    'search_key4=%s OK',
    (v) => {
      expect(() =>
        shipmentInputSchema.parse({ ...validInput, search_key4: v })
      ).not.toThrow();
    }
  );

  it('search_key1〜4 の全てで同じルール', () => {
    const valid = { ...validInput, search_key1: 'k1', search_key2: 'k2', search_key3: 'k3', search_key4: 'k4' };
    expect(() => shipmentInputSchema.parse(valid)).not.toThrow();
    expect(() =>
      shipmentInputSchema.parse({ ...validInput, search_key1: 'A'.repeat(17) })
    ).toThrow();
  });

  it('consignee_address1: 11文字 → NG（max 10）', () => {
    expect(() =>
      shipmentInputSchema.parse({ ...validInput, consignee_address1: 'A'.repeat(11) })
    ).toThrow();
  });

  it('consignee_address2: 25文字 → NG（max 24）', () => {
    expect(() =>
      shipmentInputSchema.parse({ ...validInput, consignee_address2: 'A'.repeat(25) })
    ).toThrow();
  });

  it('consignee_address3: 33文字 → NG（max 32）', () => {
    expect(() =>
      shipmentInputSchema.parse({ ...validInput, consignee_address3: 'A'.repeat(33) })
    ).toThrow();
  });

  it('consignee_department1: 51文字 → NG', () => {
    expect(() =>
      shipmentInputSchema.parse({ ...validInput, consignee_department1: 'A'.repeat(51) })
    ).toThrow();
  });

  it('note: 45文字 → NG（max 44）', () => {
    expect(() =>
      shipmentInputSchema.parse({ ...validInput, note: 'A'.repeat(45) })
    ).toThrow();
  });

  it('handling_information1/2: 21文字 → NG', () => {
    expect(() =>
      shipmentInputSchema.parse({ ...validInput, handling_information1: 'A'.repeat(21) })
    ).toThrow();
  });

  it('item_name1/2: 51文字 → NG', () => {
    expect(() =>
      shipmentInputSchema.parse({ ...validInput, item_name1: 'A'.repeat(51) })
    ).toThrow();
  });

  it('デフォルト値は上書き可能', () => {
    const r = shipmentInputSchema.parse({
      ...validInput,
      is_cool: '1',
      package_qty: '5',
      delivery_time_zone: '1618',
    });
    expect(r.is_cool).toBe('1');
    expect(r.package_qty).toBe('5');
    expect(r.delivery_time_zone).toBe('1618');
  });
});

// ============================================================
// inputToShipment
// ============================================================

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
    expect(ship.invoice_code_ext).toBe('');
    expect(ship.invoice_freight_no).toBe('01');
    expect(ship.consignee_title).toBe('様');
  });

  it('入力値がデフォルトより優先される', () => {
    const parsed = shipmentInputSchema.parse({ ...validInput, shipper_name: '株式会社上書き' });
    const ship = inputToShipment(parsed, { shipper_name: '株式会社デフォルト' });
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

  it('defaults が空でも必須フィールドは空文字で埋まる', () => {
    const parsed = shipmentInputSchema.parse(validInput);
    const ship = inputToShipment(parsed);
    expect(ship.shipper_name).toBe('');
    expect(ship.shipper_address1).toBe('');
    expect(ship.invoice_code).toBe('');
    expect(ship.invoice_code_ext).toBe('');
    expect(ship.invoice_freight_no).toBe('01'); // default
  });

  it('shipment_date は正規化される', () => {
    const parsed = shipmentInputSchema.parse({ ...validInput, shipment_date: '20260420' });
    const ship = inputToShipment(parsed);
    expect(ship.shipment_date).toBe('2026/04/20');
  });

  it('consignee_title 未指定時は "様"', () => {
    const parsed = shipmentInputSchema.parse(validInput);
    const ship = inputToShipment(parsed);
    expect(ship.consignee_title).toBe('様');
  });

  it('is_agent など全フラグがコピーされる', () => {
    const parsed = shipmentInputSchema.parse({
      ...validInput,
      is_agent: '1',
      is_using_center_service: '1',
      is_using_shipment_email: '1',
      is_using_delivery_email: '1',
    });
    const ship = inputToShipment(parsed);
    expect(ship.is_agent).toBe('1');
    expect(ship.is_using_center_service).toBe('1');
    expect(ship.is_using_shipment_email).toBe('1');
    expect(ship.is_using_delivery_email).toBe('1');
  });

  it('item_name/item_code フィールドがコピーされる', () => {
    const parsed = shipmentInputSchema.parse({
      ...validInput,
      item_name1: '商品A',
      item_code1: 'ITEM001',
      item_name2: '商品B',
      item_code2: 'ITEM002',
    });
    const ship = inputToShipment(parsed);
    expect(ship.item_name1).toBe('商品A');
    expect(ship.item_code1).toBe('ITEM001');
    expect(ship.item_name2).toBe('商品B');
    expect(ship.item_code2).toBe('ITEM002');
  });

  it('空文字の optional フィールドはコピーされない', () => {
    const parsed = shipmentInputSchema.parse({ ...validInput, item_name1: '' });
    const ship = inputToShipment(parsed);
    expect((ship as any).item_name1).toBeUndefined();
  });

  it('collect 用 amount / tax_amount がコピーされる', () => {
    const parsed = shipmentInputSchema.parse({
      ...validInput,
      service_type: '2',
      amount: '10000',
      tax_amount: '1000',
    });
    const ship = inputToShipment(parsed);
    expect(ship.amount).toBe('10000');
    expect(ship.tax_amount).toBe('1000');
  });

  it('collect 12 フィールドがコピーされる', () => {
    const parsed = shipmentInputSchema.parse({
      ...validInput,
      is_agent: '1',
      agent_amount: '5000',
      agent_tax_amount: '500',
      agent_invoice_name: '名前',
      agent_invoice_zip_code: '100-0001',
    });
    const ship = inputToShipment(parsed);
    expect(ship.agent_amount).toBe('5000');
    expect(ship.agent_tax_amount).toBe('500');
    expect(ship.agent_invoice_name).toBe('名前');
  });
});

// ============================================================
// historySearchSchema
// ============================================================

describe('historySearchSchema', () => {
  it('全フィールド optional', () => {
    expect(() => historySearchSchema.parse({})).not.toThrow();
  });

  it('service_type が enum', () => {
    expect(() => historySearchSchema.parse({ service_type: 'X' })).toThrow();
    expect(() => historySearchSchema.parse({ service_type: '0' })).not.toThrow();
  });

  it('tracking_number optional', () => {
    expect(() => historySearchSchema.parse({ tracking_number: '123456789012' })).not.toThrow();
  });

  it('search_key4 optional', () => {
    expect(() => historySearchSchema.parse({ search_key4: 'KEY' })).not.toThrow();
  });

  it('from_date / to_date optional', () => {
    expect(() =>
      historySearchSchema.parse({ from_date: '2026/01/01', to_date: '2026/12/31' })
    ).not.toThrow();
  });
});

// ============================================================
// reprintSchema
// ============================================================

describe('reprintSchema', () => {
  it('tracking_number 必須', () => {
    expect(() => reprintSchema.parse({})).toThrow();
    expect(() => reprintSchema.parse({ tracking_number: '' })).toThrow();
    expect(() => reprintSchema.parse({ tracking_number: '123456789012' })).not.toThrow();
  });

  it('print_type optional', () => {
    expect(() =>
      reprintSchema.parse({ tracking_number: '123456789012', print_type: 'm5' })
    ).not.toThrow();
  });

  it('print_type 不正値は NG', () => {
    expect(() =>
      reprintSchema.parse({ tracking_number: '123456789012', print_type: 'XX' as any })
    ).toThrow();
  });

  it('output_format optional', () => {
    expect(() =>
      reprintSchema.parse({ tracking_number: '123456789012', output_format: 'a4_multi' })
    ).not.toThrow();
  });
});

// ============================================================
// deleteSavedSchema
// ============================================================

describe('deleteSavedSchema', () => {
  it('ids 必須、最低1要素', () => {
    expect(() => deleteSavedSchema.parse({ ids: [] })).toThrow();
    expect(() => deleteSavedSchema.parse({ ids: ['UMN123'] })).not.toThrow();
  });

  it('ids の各要素は non-empty string', () => {
    expect(() => deleteSavedSchema.parse({ ids: [''] })).toThrow();
  });

  it('複数 ID OK', () => {
    expect(() =>
      deleteSavedSchema.parse({ ids: ['UMN1', 'UMN2', 'UMN3'] })
    ).not.toThrow();
  });
});

// ============================================================
// setPrinterTypeSchema
// ============================================================

describe('setPrinterTypeSchema', () => {
  it.each(['1', '2', '3'])('printer_type=%s OK', (v) => {
    expect(() => setPrinterTypeSchema.parse({ printer_type: v })).not.toThrow();
  });

  it.each(['0', '4', '', 'X'])('printer_type=%s NG', (v) => {
    expect(() => setPrinterTypeSchema.parse({ printer_type: v as any })).toThrow();
  });
});

// ============================================================
// enum スキーマ
// ============================================================

describe('serviceTypeSchema', () => {
  it.each(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A'])('%s OK', (s) => {
    expect(() => serviceTypeSchema.parse(s)).not.toThrow();
  });

  it.each(['', 'B', 'Z', '10', 'X'])('%s NG', (s) => {
    expect(() => serviceTypeSchema.parse(s)).toThrow();
  });
});

describe('printTypeSchema', () => {
  it.each(['m', 'm5', '0', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'CP'])(
    '%s OK',
    (s) => {
      expect(() => printTypeSchema.parse(s)).not.toThrow();
    }
  );

  it.each(['', 'X', '1', 'B', 'CP2'])('%s NG', (s) => {
    expect(() => printTypeSchema.parse(s)).toThrow();
  });
});

describe('printerTypeSchema', () => {
  it.each(['1', '2', '3'])('%s OK', (s) => {
    expect(() => printerTypeSchema.parse(s)).not.toThrow();
  });
  it.each(['0', '4', '', 'X'])('%s NG', (s) => {
    expect(() => printerTypeSchema.parse(s)).toThrow();
  });
});

describe('outputFormatSchema', () => {
  it.each(['a4_multi', 'a5_multi', 'label'])('%s OK', (s) => {
    expect(() => outputFormatSchema.parse(s)).not.toThrow();
  });
  it.each(['', 'a3', 'multi', 'LABEL'])('%s NG', (s) => {
    expect(() => outputFormatSchema.parse(s)).toThrow();
  });
});

// ============================================================
// getDefaultShipperFromEnv
// ============================================================

describe('getDefaultShipperFromEnv', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.B2_DEFAULT_SHIPPER_NAME;
    delete process.env.B2_DEFAULT_SHIPPER_TEL;
    delete process.env.B2_DEFAULT_SHIPPER_ZIP;
    delete process.env.B2_DEFAULT_SHIPPER_ADDR1;
    delete process.env.B2_DEFAULT_SHIPPER_ADDR2;
    delete process.env.B2_DEFAULT_SHIPPER_ADDR3;
    delete process.env.B2_DEFAULT_INVOICE_CODE;
    delete process.env.B2_DEFAULT_INVOICE_CODE_EXT;
    delete process.env.B2_DEFAULT_INVOICE_FREIGHT_NO;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('環境変数未設定時はほぼ undefined', () => {
    const d = getDefaultShipperFromEnv();
    expect(d.shipper_name).toBeUndefined();
    expect(d.shipper_zip_code).toBeUndefined();
    expect(d.invoice_code).toBeUndefined();
    expect(d.invoice_code_ext).toBe('');
    expect(d.invoice_freight_no).toBe('01'); // default
  });

  it('環境変数から取得', () => {
    process.env.B2_DEFAULT_SHIPPER_NAME = '株式会社テスト';
    process.env.B2_DEFAULT_SHIPPER_TEL = '03-1234-5678';
    process.env.B2_DEFAULT_SHIPPER_ZIP = '100-0001';
    process.env.B2_DEFAULT_SHIPPER_ADDR1 = '東京都';
    process.env.B2_DEFAULT_SHIPPER_ADDR2 = '千代田区';
    process.env.B2_DEFAULT_SHIPPER_ADDR3 = '1-1';
    process.env.B2_DEFAULT_INVOICE_CODE = '0482540070';
    process.env.B2_DEFAULT_INVOICE_CODE_EXT = '';
    process.env.B2_DEFAULT_INVOICE_FREIGHT_NO = '02';

    const d = getDefaultShipperFromEnv();
    expect(d.shipper_name).toBe('株式会社テスト');
    expect(d.shipper_telephone_display).toBe('03-1234-5678');
    expect(d.shipper_zip_code).toBe('100-0001');
    expect(d.shipper_address1).toBe('東京都');
    expect(d.shipper_address2).toBe('千代田区');
    expect(d.shipper_address3).toBe('1-1');
    expect(d.invoice_code).toBe('0482540070');
    expect(d.invoice_freight_no).toBe('02');
  });

  it('invoice_code_ext のデフォルトは空文字', () => {
    const d = getDefaultShipperFromEnv();
    expect(d.invoice_code_ext).toBe('');
  });

  it('invoice_freight_no のデフォルトは 01', () => {
    const d = getDefaultShipperFromEnv();
    expect(d.invoice_freight_no).toBe('01');
  });
});
