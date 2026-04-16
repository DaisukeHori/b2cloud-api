/**
 * E2E: 伝票 CRUD 操作（印刷しないので安全）
 *
 * ★実 B2クラウドへの接続が必要、ただし発行はしない★
 *
 * 検証項目:
 * - checkShipment が error_flg='0' or '9' で返り、サーバー自動補完される
 * - saveShipment が tracking_number (UMN形式) と link を返す
 * - listSavedShipments で保存済み一覧に検出できる
 * - findSavedBySearchKey4 で正しく見つかる
 * - deleteSavedShipments (DELETE /b2/p/new、msgpack+zlib) で削除できる
 * - 削除後 listSavedShipments で見つからない
 *
 * テスト後の状態: 全削除されている（テストが冪等になるよう）
 */

import { describe, it, expect, afterAll } from 'vitest';
import { login, resolveLoginConfig } from '../../src/auth';
import {
  checkShipment,
  saveShipment,
  listSavedShipments,
  findSavedBySearchKey4,
  deleteSavedShipments,
} from '../../src/shipment';
import { generateUniqueKey } from '../../src/b2client';
import type { B2Session, Shipment, FeedEntry } from '../../src/types';
import {
  isE2EEnabled,
  getTestShipper,
  getTestConsignee,
  getTestInvoice,
  tomorrowDate,
} from './setup';

describe.skipIf(!isE2EEnabled())('E2E: 伝票 CRUD (実 B2クラウド、印刷しない)', () => {
  let session: B2Session;
  const createdEntries: FeedEntry<Shipment>[] = [];
  const searchKey4 = generateUniqueKey('E2E');

  // テスト用伝票データ（発払い・最短日）
  function buildTestShipment(): Shipment {
    return {
      service_type: '0', // 発払い
      shipment_date: tomorrowDate(),
      is_cool: '0',
      short_delivery_date_flag: '1', // 最短日
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
      item_name1: 'E2E test item',
      item_code1: 'E2E001',
      search_key_title4: 'E2E',
      search_key4: searchKey4,
    };
  }

  // テスト後にこのテストで作った伝票を削除（CIで残骸が積もらないよう）
  afterAll(async () => {
    if (!session || createdEntries.length === 0) return;
    try {
      await deleteSavedShipments(session, createdEntries);
    } catch (e) {
      console.warn('[E2E cleanup] deleteSavedShipments failed:', e);
    }
  });

  it('login() で実セッションを確立', async () => {
    session = await login(resolveLoginConfig({}));
    expect(session.baseUrl).toBeTruthy();
  }, 30_000);

  it('checkShipment() で error_flg が "0" または "9" として返る', async () => {
    const shipment = buildTestShipment();
    const checked = await checkShipment(session, shipment);

    expect(checked.shipment).toBeTruthy();
    expect(['0', '9']).toContain(checked.shipment?.error_flg);

    // サーバー自動補完フィールドの一部が入っているか
    expect(checked.shipment?.checked_date).toBeTruthy();
    expect(checked.shipment?.consignee_telephone).toBeTruthy(); // 正規化された電話番号
  });

  it('saveShipment() で UMN 形式の tracking_number と link が返る', async () => {
    const shipment = buildTestShipment();
    const checked = await checkShipment(session, shipment);
    const saved = await saveShipment(session, checked);

    // tracking_number が UMN 形式 (内部管理番号)
    expect(saved.shipment?.tracking_number).toMatch(/^UMN\d+$/);

    // link[0].___href があり、削除に使える
    expect(saved.link).toBeTruthy();
    expect(saved.link?.[0].___href).toBeTruthy();

    // shipment_flg='0' (保存モード)
    expect(saved.shipment?.shipment_flg).toBe('0');

    // search_key4 が設定したものと一致
    expect(saved.shipment?.search_key4).toBe(searchKey4);

    createdEntries.push(saved);
  });

  it('listSavedShipments() で保存済み一覧に表示される', async () => {
    const list = await listSavedShipments(session, '0'); // 発払いのみ
    expect(list.length).toBeGreaterThan(0);

    // この search_key4 を持つエントリが含まれる
    const found = list.find((e) => e.shipment?.search_key4 === searchKey4);
    expect(found).toBeTruthy();
  });

  it('findSavedBySearchKey4() で対象伝票を引ける', async () => {
    const found = await findSavedBySearchKey4(session, searchKey4, '0');
    expect(found).toBeTruthy();
    expect(found?.shipment?.search_key4).toBe(searchKey4);
  });

  it('deleteSavedShipments() で削除できる (DELETE /b2/p/new + msgpack+zlib)', async () => {
    expect(createdEntries.length).toBeGreaterThan(0);

    await deleteSavedShipments(session, createdEntries);

    // 削除完了したので createdEntries をクリア (afterAll の二重削除防止)
    createdEntries.length = 0;
  });

  it('削除後は listSavedShipments で見つからない', async () => {
    // ↑ deleteSavedShipments が完了直後はキャッシュかもしれないので 1秒待つ
    await new Promise((r) => setTimeout(r, 1_000));

    const list = await listSavedShipments(session, '0');
    const found = list.find((e) => e.shipment?.search_key4 === searchKey4);
    expect(found).toBeUndefined();
  });
});
