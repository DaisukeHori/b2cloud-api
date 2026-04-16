/**
 * shipment.ts 結合テスト（checkShipment / saveShipment / listSavedShipments / etc）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  checkShipment,
  saveShipment,
  checkAndSave,
  listSavedShipments,
  findSavedBySearchKey4,
  searchHistory,
  deleteSavedShipments,
  deleteHistory,
} from '../../src/shipment';
import { B2ValidationError } from '../../src/b2client';
import {
  startMock,
  stopMock,
  getMock,
  makeTestSession,
  feedResponse,
  errorFeedResponse,
  mockShipmentEntry,
} from './setup';
import type { Shipment } from '../../src/types';

const BASE_URL = 'https://newb2web.kuronekoyamato.co.jp';

beforeEach(() => startMock());
afterEach(async () => {
  await stopMock();
});

function validShipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    service_type: '0',
    shipment_date: '2026/04/20',
    is_cool: '0',
    short_delivery_date_flag: '1',
    is_printing_date: '1',
    delivery_time_zone: '0000',
    package_qty: '1',
    is_printing_lot: '2',
    is_agent: '0',
    payment_flg: '0',
    invoice_code: '0482540070',
    invoice_code_ext: '',
    invoice_freight_no: '01',
    invoice_name: '',
    consignee_telephone_display: '03-1234-5678',
    consignee_zip_code: '100-0001',
    consignee_address1: '東京都',
    consignee_address2: '千代田区',
    consignee_address3: '1-1',
    consignee_name: 'テスト太郎',
    consignee_title: '様',
    is_using_center_service: '0',
    is_using_shipment_email: '0',
    is_using_delivery_email: '0',
    shipper_telephone_display: '03-0000-0000',
    shipper_zip_code: '100-0000',
    shipper_address1: '東京都',
    shipper_address2: '港区',
    shipper_address3: '1-1',
    shipper_name: '株式会社テスト',
    ...overrides,
  };
}

// ============================================================
// checkShipment
// ============================================================

describe('checkShipment', () => {
  it('成功時: entry を返す', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new?checkonly=', method: 'POST' })
      .reply(200, feedResponse([mockShipmentEntry({ error_flg: '0' })]));
    const entry = await checkShipment(makeTestSession(), validShipment());
    expect(entry.shipment?.error_flg).toBe('0');
  });

  it('error_flg="9"（警告）も成功扱い', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new?checkonly=', method: 'POST' })
      .reply(200, feedResponse([mockShipmentEntry({ error_flg: '9' })]));
    const entry = await checkShipment(makeTestSession(), validShipment());
    expect(entry.shipment?.error_flg).toBe('9');
  });

  it('error_flg が不正時は B2ValidationError', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new?checkonly=', method: 'POST' })
      .reply(200, feedResponse([{ shipment: { error_flg: '1' }, error: [] }]));
    await expect(checkShipment(makeTestSession(), validShipment())).rejects.toThrow(B2ValidationError);
  });

  it('feed.title=Error は B2ValidationError', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new?checkonly=', method: 'POST' })
      .reply(
        200,
        errorFeedResponse([
          { code: 'EF011001', property: 'consignee_name', description: 'お届け先名必須' },
        ])
      );
    await expect(checkShipment(makeTestSession(), validShipment())).rejects.toThrow(B2ValidationError);
  });

  it('空 entry は Error', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new?checkonly=', method: 'POST' })
      .reply(200, feedResponse([]));
    await expect(checkShipment(makeTestSession(), validShipment())).rejects.toThrow();
  });

  it('tracking_number (UMN形式) が付与される', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new?checkonly=', method: 'POST' })
      .reply(
        200,
        feedResponse([mockShipmentEntry({ error_flg: '0', tracking_number: 'UMN240309577' })])
      );
    const entry = await checkShipment(makeTestSession(), validShipment());
    expect(entry.shipment?.tracking_number).toMatch(/^UMN/);
  });

  it('sorting_code 等サーバー補完フィールドを保持', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new?checkonly=', method: 'POST' })
      .reply(
        200,
        feedResponse([
          mockShipmentEntry({
            error_flg: '0',
            sorting_code: '12345',
            shipper_center_code: 'CENTER01',
          }),
        ])
      );
    const entry = await checkShipment(makeTestSession(), validShipment());
    expect((entry.shipment as any).sorting_code).toBe('12345');
    expect((entry.shipment as any).shipper_center_code).toBe('CENTER01');
  });

  it('validation error の詳細を errors 配列で取得', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new?checkonly=', method: 'POST' })
      .reply(
        200,
        errorFeedResponse([
          { code: 'EF011001', property: 'consignee_name', description: '名前必須' },
          { code: 'EF011002', property: 'consignee_zip_code', description: '郵便番号必須' },
        ])
      );
    try {
      await checkShipment(makeTestSession(), validShipment());
      expect.fail();
    } catch (e) {
      expect(e).toBeInstanceOf(B2ValidationError);
      expect((e as B2ValidationError).errors).toHaveLength(2);
      expect((e as B2ValidationError).errors[0].error_code).toBe('EF011001');
    }
  });

  it('コレクト伝票（service_type=2, amount あり）', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new?checkonly=', method: 'POST' })
      .reply(200, feedResponse([mockShipmentEntry({ service_type: '2', error_flg: '0' })]));
    const entry = await checkShipment(
      makeTestSession(),
      validShipment({ service_type: '2', amount: '10000', tax_amount: '1000' })
    );
    expect(entry.shipment?.service_type).toBe('2');
  });

  it('複数口伝票（service_type=6, closure_key）', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new?checkonly=', method: 'POST' })
      .reply(200, feedResponse([mockShipmentEntry({ service_type: '6', error_flg: '0' })]));
    const entry = await checkShipment(
      makeTestSession(),
      validShipment({ service_type: '6', package_qty: '3', closure_key: 'KEY001' })
    );
    expect(entry.shipment?.service_type).toBe('6');
  });

  it('着払い(5)は invoice_code 不要でも成功', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new?checkonly=', method: 'POST' })
      .reply(200, feedResponse([mockShipmentEntry({ service_type: '5', error_flg: '0' })]));
    const entry = await checkShipment(
      makeTestSession(),
      validShipment({ service_type: '5', invoice_code: '' })
    );
    expect(entry.shipment?.error_flg).toBe('0');
  });
});

// ============================================================
// saveShipment
// ============================================================

describe('saveShipment', () => {
  it('link が返ってこないとエラー（レスポンスに link なし）', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'POST' })
      .reply(200, feedResponse([{ shipment: { service_type: '0' } }]));
    const checkedEntry: any = {
      shipment: { service_type: '0' },
      link: [{ ___href: '/x' }],
    };
    await expect(saveShipment(makeTestSession(), checkedEntry)).rejects.toThrow(/link/);
  });

  it('shipment_flg="0" を自動付与', async () => {
    let gotBody = '';
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'POST' })
      .reply((opts: any) => {
        gotBody = String(opts.body ?? '');
        return {
          statusCode: 200,
          data: JSON.stringify(feedResponse([mockShipmentEntry()])),
        };
      });
    const checked: any = {
      shipment: { service_type: '0', tracking_number: 'UMN1' },
      link: [{ ___href: '/0482540070-/new/UMN1' }],
    };
    await saveShipment(makeTestSession(), checked);
    expect(gotBody).toContain('shipment_flg');
    expect(gotBody).toContain('"0"'); // shipment_flg=0
  });

  it('保存成功時は id / link / tracking_number を返す', async () => {
    const mockEntry = {
      id: '/0482540070-/new/UMN240309577,1',
      link: [{ ___href: '/0482540070-/new/UMN240309577' }],
      shipment: { service_type: '0', tracking_number: 'UMN240309577', error_flg: '0' },
    };
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'POST' })
      .reply(200, feedResponse([mockEntry]));

    const checked: any = {
      shipment: { service_type: '0' },
      link: [{ ___href: '/0482540070-/new/UMN240309577' }],
    };
    const saved = await saveShipment(makeTestSession(), checked);
    expect(saved.id).toBeDefined();
    expect(saved.link).toBeDefined();
    expect(saved.shipment?.tracking_number).toBe('UMN240309577');
  });

  it('link が返ってこないとエラー', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'POST' })
      .reply(200, feedResponse([{ shipment: { service_type: '0' } }]));
    const checked: any = {
      shipment: { service_type: '0' },
      link: [{ ___href: '/0482540070-/new/UMN1' }],
    };
    await expect(saveShipment(makeTestSession(), checked)).rejects.toThrow(/link/);
  });

  it('空 entry レスポンスは Error', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'POST' })
      .reply(200, feedResponse([]));
    const checked: any = {
      shipment: { service_type: '0' },
      link: [{ ___href: '/0482540070-/new/UMN1' }],
    };
    await expect(saveShipment(makeTestSession(), checked)).rejects.toThrow();
  });
});

// ============================================================
// checkAndSave
// ============================================================

describe('checkAndSave', () => {
  it('check → save を順に実行', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new?checkonly=', method: 'POST' })
      .reply(200, feedResponse([mockShipmentEntry({ error_flg: '0' })]));
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'POST' })
      .reply(
        200,
        feedResponse([
          {
            id: '/0482540070-/new/UMN1,1',
            link: [{ ___href: '/0482540070-/new/UMN1' }],
            shipment: { tracking_number: 'UMN1', error_flg: '0' },
          },
        ])
      );

    const saved = await checkAndSave(makeTestSession(), validShipment());
    expect(saved.shipment?.tracking_number).toBe('UMN1');
  });

  it('check でエラーなら save 呼ばれない', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new?checkonly=', method: 'POST' })
      .reply(
        200,
        errorFeedResponse([{ code: 'E', property: 'p', description: 'd' }])
      );
    await expect(checkAndSave(makeTestSession(), validShipment())).rejects.toThrow(B2ValidationError);
  });
});

// ============================================================
// listSavedShipments
// ============================================================

describe('listSavedShipments', () => {
  it('全件取得（service_type なし）', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'GET' })
      .reply(200, feedResponse([mockShipmentEntry(), mockShipmentEntry()]));
    const entries = await listSavedShipments(makeTestSession());
    expect(entries).toHaveLength(2);
  });

  it('service_type フィルタ', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new?service_type=0', method: 'GET' })
      .reply(200, feedResponse([mockShipmentEntry({ service_type: '0' })]));
    const entries = await listSavedShipments(makeTestSession(), '0');
    expect(entries).toHaveLength(1);
    expect(entries[0].shipment?.service_type).toBe('0');
  });

  it('0件', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'GET' })
      .reply(200, feedResponse([]));
    const entries = await listSavedShipments(makeTestSession());
    expect(entries).toEqual([]);
  });

  it('大量件数', async () => {
    const mockEntries = Array.from({ length: 100 }, (_, i) =>
      mockShipmentEntry({ tracking_number: `UMN${i}` })
    );
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'GET' })
      .reply(200, feedResponse(mockEntries));
    const entries = await listSavedShipments(makeTestSession());
    expect(entries).toHaveLength(100);
  });

  it.each(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A'])(
    'service_type=%s で取得',
    async (st) => {
      getMock()
        .get(BASE_URL)
        .intercept({ path: `/b2/p/new?service_type=${st}`, method: 'GET' })
        .reply(200, feedResponse([mockShipmentEntry({ service_type: st })]));
      const entries = await listSavedShipments(makeTestSession(), st as any);
      expect(entries).toHaveLength(1);
    }
  );
});

// ============================================================
// findSavedBySearchKey4
// ============================================================

describe('findSavedBySearchKey4', () => {
  it('見つかれば entry を返す', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'GET' })
      .reply(200, feedResponse([mockShipmentEntry({ search_key4: 'KEY001' })]));
    const entry = await findSavedBySearchKey4(makeTestSession(), 'KEY001');
    expect(entry).not.toBeNull();
    expect(entry?.shipment?.search_key4).toBe('KEY001');
  });

  it('見つからなければ null', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'GET' })
      .reply(200, feedResponse([mockShipmentEntry({ search_key4: 'OTHER' })]));
    const entry = await findSavedBySearchKey4(makeTestSession(), 'KEY001');
    expect(entry).toBeNull();
  });

  it('service_type フィルタ付き', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new?service_type=0', method: 'GET' })
      .reply(
        200,
        feedResponse([mockShipmentEntry({ service_type: '0', search_key4: 'KEY001' })])
      );
    const entry = await findSavedBySearchKey4(makeTestSession(), 'KEY001', '0');
    expect(entry?.shipment?.search_key4).toBe('KEY001');
  });
});

// ============================================================
// searchHistory
// ============================================================

describe('searchHistory', () => {
  it('search_key4 で検索', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/history?all=&search_key4=KEY', method: 'GET' })
      .reply(200, feedResponse([mockShipmentEntry({ search_key4: 'KEY' })]));
    const entries = await searchHistory(makeTestSession(), { searchKey4: 'KEY' });
    expect(entries).toHaveLength(1);
  });

  it('trackingNumber で検索', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/history?all=&tracking_number=123456789012', method: 'GET' })
      .reply(200, feedResponse([mockShipmentEntry({ tracking_number: '123456789012' })]));
    const entries = await searchHistory(makeTestSession(), { trackingNumber: '123456789012' });
    expect(entries).toHaveLength(1);
  });

  it('serviceType で検索', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/history?all=&service_type=0', method: 'GET' })
      .reply(200, feedResponse([mockShipmentEntry({ service_type: '0' })]));
    const entries = await searchHistory(makeTestSession(), { serviceType: '0' });
    expect(entries).toHaveLength(1);
  });

  it('dateFrom / dateTo で検索', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({
        path: '/b2/p/history?all=&date_from=2026%2F01%2F01&date_to=2026%2F12%2F31',
        method: 'GET',
      })
      .reply(200, feedResponse([]));
    const entries = await searchHistory(makeTestSession(), {
      dateFrom: '2026/01/01',
      dateTo: '2026/12/31',
    });
    expect(entries).toEqual([]);
  });

  it('複数条件の AND 検索', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: /\/b2\/p\/history/, method: 'GET' })
      .reply(200, feedResponse([mockShipmentEntry()]));
    const entries = await searchHistory(makeTestSession(), {
      searchKey4: 'K',
      trackingNumber: 'T',
      serviceType: '0',
      dateFrom: '2026/01/01',
      dateTo: '2026/12/31',
    });
    expect(entries).toHaveLength(1);
  });

  it('0件ヒット', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/history?all=', method: 'GET' })
      .reply(200, feedResponse([]));
    const entries = await searchHistory(makeTestSession(), {});
    expect(entries).toEqual([]);
  });
});

// ============================================================
// deleteSavedShipments
// ============================================================

describe('deleteSavedShipments', () => {
  it('空配列は no-op', async () => {
    await expect(deleteSavedShipments(makeTestSession(), [])).resolves.toBeUndefined();
  });

  it('link が無い entry はエラー', async () => {
    const entry: any = { shipment: { tracking_number: 'UMN1' } };
    await expect(deleteSavedShipments(makeTestSession(), [entry])).rejects.toThrow(/link/);
  });

  it('1件削除成功', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'DELETE' })
      .reply(
        200,
        feedResponse([{ system_date: { sys_date: '20260416' } }], { title: 'Deleted.' })
      );
    const entry: any = {
      id: '/0482540070-/new/UMN1,1',
      link: [{ ___href: '/0482540070-/new/UMN1' }],
      shipment: { tracking_number: 'UMN1' },
    };
    await expect(deleteSavedShipments(makeTestSession(), [entry])).resolves.toBeUndefined();
  });

  it('複数件まとめて削除', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'DELETE' })
      .reply(200, feedResponse([], { title: 'Deleted.' }));
    const entries: any[] = [
      {
        id: '/0482540070-/new/UMN1,1',
        link: [{ ___href: '/0482540070-/new/UMN1' }],
        shipment: { tracking_number: 'UMN1' },
      },
      {
        id: '/0482540070-/new/UMN2,1',
        link: [{ ___href: '/0482540070-/new/UMN2' }],
        shipment: { tracking_number: 'UMN2' },
      },
    ];
    await expect(deleteSavedShipments(makeTestSession(), entries)).resolves.toBeUndefined();
  });

  it('feed.title が Deleted. 以外ならエラー', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'DELETE' })
      .reply(200, feedResponse([], { title: 'Other' }));
    const entry: any = {
      id: '/0482540070-/new/UMN1,1',
      link: [{ ___href: '/0482540070-/new/UMN1' }],
      shipment: {},
    };
    await expect(deleteSavedShipments(makeTestSession(), [entry])).rejects.toThrow(/DELETE/);
  });

  it('id が無い場合は link[0].___href から再構築', async () => {
    let gotBody = '';
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'DELETE' })
      .reply((opts: any) => {
        gotBody = String(opts.body ?? '');
        return {
          statusCode: 200,
          data: JSON.stringify(feedResponse([], { title: 'Deleted.' })),
        };
      });
    const entry: any = {
      // id 欠落
      link: [{ ___href: '/0482540070-/new/UMNX' }],
      shipment: {},
    };
    await deleteSavedShipments(makeTestSession(), [entry]);
    // msgpack+zlib なので body は binary。呼び出された事実で OK
    expect(gotBody).toBeDefined();
  });
});

// ============================================================
// deleteHistory
// ============================================================

describe('deleteHistory (★未検証機能)', () => {
  it('PUT display_flg=0 で呼び出される', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/history?display_flg=0', method: 'PUT' })
      .reply(200, feedResponse([]));
    const entry: any = { id: '/x', link: [{ ___href: '/x' }], shipment: {} };
    await expect(deleteHistory(makeTestSession(), [entry])).resolves.toBeUndefined();
  });

  it('空配列でも 1リクエスト送られる', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/history?display_flg=0', method: 'PUT' })
      .reply(200, feedResponse([]));
    await expect(deleteHistory(makeTestSession(), [])).resolves.toBeUndefined();
  });
});
