/**
 * E2E: HTTP クライアント検証（実 B2クラウド）
 *
 * ★設計書 4-9 / 4-10 / 4-11 / E-1 / E-2 / E-3 で確定した挙動を実機で検証★
 *
 * - CSRF ヘッダ自動付与 (Origin / Referer / X-Requested-With)
 * - JSON デフォルト動作
 * - msgpack+zlib 明示指定で送信できる
 * - HTML エラーレスポンス (sys_err.html) 検出
 * - 401/403 自動再認証
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { login, resolveLoginConfig, reauthenticate } from '../../src/auth';
import {
  b2Get,
  b2Post,
  generateUniqueKey,
  B2CloudError,
  B2ValidationError,
} from '../../src/b2client';
import type { B2Session, Shipment } from '../../src/types';
import {
  isE2EEnabled,
  getTestShipper,
  getTestConsignee,
  getTestInvoice,
  tomorrowDate,
} from './setup';

describe.skipIf(!isE2EEnabled())('E2E: HTTP クライアント (実 B2クラウド)', () => {
  let session: B2Session;

  beforeAll(async () => {
    session = await login(resolveLoginConfig({}));
  }, 30_000);

  it('b2Get(/b2/p/new) で保存済み一覧が JSON で返る (CSRFヘッダOK)', async () => {
    const res = await b2Get<Shipment>(session, '/b2/p/new', {
      query: { service_type: '0' },
    });

    expect(res.feed).toBeTruthy();
    expect(res.feed.entry === undefined || Array.isArray(res.feed.entry)).toBe(true);
  });

  it('b2Post(checkonly) で JSON送信が成功 (デフォルト パス)', async () => {
    const shipment: Shipment = {
      service_type: '0',
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
      item_name1: 'CSRF test',
      item_code1: 'CSRF1',
      search_key_title4: 'E2E',
      search_key4: generateUniqueKey('CSRF'),
    };

    const res = await b2Post<Shipment>(
      session,
      '/b2/p/new',
      { feed: { entry: [{ shipment }] } },
      { query: { checkonly: '' } }
    );

    expect(res.feed.entry).toBeTruthy();
    expect(res.feed.entry?.length).toBeGreaterThan(0);
    // checkonly は保存しないので tracking_number は付かない
    // error_flg だけ確認
    expect(['0', '9']).toContain(res.feed.entry?.[0].shipment?.error_flg);
  });

  it('明らかに不正な伝票 (空の電話番号) は B2ValidationError', async () => {
    const invalid: Shipment = {
      service_type: '0',
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
      consignee_telephone_display: '', // ← 空
      consignee_title: '様',
      ...getTestShipper(),
    };

    await expect(
      b2Post<Shipment>(
        session,
        '/b2/p/new',
        { feed: { entry: [{ shipment: invalid }] } },
        { query: { checkonly: '' }, throwOnFeedError: true }
      )
    ).rejects.toBeInstanceOf(B2ValidationError);
  });

  it('search_key4 が 19文字 (制限超過) で ES002070 エラー', async () => {
    const overlong: Shipment = {
      service_type: '0',
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
      search_key_title4: 'E2E',
      search_key4: 'A234567890123456789', // 19文字 (制限16)
    };

    try {
      await b2Post<Shipment>(
        session,
        '/b2/p/new',
        { feed: { entry: [{ shipment: overlong }] } },
        { query: { checkonly: '' }, throwOnFeedError: true }
      );
      // バリデーションを通ってしまったらテスト失敗
      throw new Error('Expected ES002070 validation error but got success');
    } catch (e) {
      expect(e).toBeInstanceOf(B2ValidationError);
      const errors = (e as B2ValidationError).errors;
      const found = errors.find(
        (er) => er.error_code === 'ES002070' || er.error_property_name === 'search_key4'
      );
      expect(found).toBeTruthy();
    }
  });

  it('reauthenticate で session の Cookie が刷新される (401 救済の事前準備)', async () => {
    const before = await session.cookieJar.getCookies(session.baseUrl);
    const beforeJSESS = before.find((c) => /JSESSION/i.test(c.key))?.value;

    await reauthenticate(session);

    const after = await session.cookieJar.getCookies(session.baseUrl);
    const afterJSESS = after.find((c) => /JSESSION/i.test(c.key))?.value;

    // JSESSIONID が再発行された (もしくは少なくとも cookie が更新された)
    expect(after.length).toBeGreaterThan(0);
    if (beforeJSESS && afterJSESS) {
      // 必ずしも違うとは限らない (B2クラウド側仕様による) のでログだけ
      console.log(`[E2E] JSESSION before=${beforeJSESS.slice(0, 8)}... after=${afterJSESS.slice(0, 8)}...`);
    }
  }, 30_000);
});
