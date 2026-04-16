/**
 * B2クラウド 伝票CRUD操作
 *
 * ★実機検証済みフロー★
 *
 * 1. checkShipment() → POST /b2/p/new?checkonly
 *    - サーバー自動補完フィールド付きの shipment を返す
 *    - 補完後の shipment_flg='0' を付与して save へ渡す
 *
 * 2. saveShipment() → POST /b2/p/new
 *    - 保存済み伝票として登録
 *    - tracking_number（内部ID "UMN..."）が払い出される
 *
 * 3. listSavedShipments() → GET /b2/p/new?service_type=X
 *    - 保存済み伝票一覧（サービス種別で絞り込み）
 *
 * 4. deleteSavedShipments() → PUT /b2/p/new?all&display_flg=0
 *    - 論理削除
 */

import { b2Get, b2Post, b2Put, B2ValidationError } from './b2client';
import type {
  B2Session,
  B2Response,
  FeedEntry,
  Shipment,
  ServiceType,
} from './types';

// ============================================================
// バリデーションのみ（checkonly）
// ============================================================

/**
 * 伝票のバリデーションのみ実行（保存しない）
 *
 * サーバーが自動補完するフィールド（sorting_code, shipper_center_code など）が
 * 付与された状態で返る。返された shipment をそのまま saveShipment() に渡せる。
 *
 * @param session 確立済みセッション
 * @param shipment 検証する伝票
 * @returns サーバー補完済みのentry
 * @throws B2ValidationError エラーがある場合（error_flg=0 or 9 なら正常）
 */
export async function checkShipment(
  session: B2Session,
  shipment: Shipment
): Promise<FeedEntry<Shipment>> {
  const res = await b2Post<Shipment>(session, '/b2/p/new', {
    feed: { entry: [{ shipment }] },
  }, { query: { checkonly: '' } });

  const entry = res.feed.entry?.[0];
  if (!entry) {
    throw new Error('B2クラウドから空のレスポンスが返りました');
  }

  // error_flg = '0' 完全正常, '9' 警告あり正常
  const errorFlg = entry.shipment?.error_flg;
  if (errorFlg !== '0' && errorFlg !== '9') {
    throw new B2ValidationError(
      `バリデーション失敗 (error_flg=${errorFlg})`,
      entry.error ?? []
    );
  }

  return entry;
}

// ============================================================
// 保存
// ============================================================

/**
 * 伝票を保存（checkonly後のentryを受け取る）
 *
 * @param session 確立済みセッション
 * @param checkedEntry checkShipment() の返り値
 * @returns 保存済みentry（id, link, tracking_number="UMN..."含む）
 */
export async function saveShipment(
  session: B2Session,
  checkedEntry: FeedEntry<Shipment>
): Promise<FeedEntry<Shipment>> {
  // shipment_flg='0' を確実に付与（保存モード）
  const entry: FeedEntry<Shipment> = {
    ...checkedEntry,
    shipment: {
      ...checkedEntry.shipment!,
      shipment_flg: '0',
    },
  };

  const res = await b2Post<Shipment>(session, '/b2/p/new', {
    feed: { entry: [entry] },
  });

  const saved = res.feed.entry?.[0];
  if (!saved) {
    throw new Error('保存レスポンスから entry が取得できません');
  }
  if (!saved.link || saved.link.length === 0) {
    throw new Error('保存レスポンスから link が取得できません');
  }

  return saved;
}

/**
 * check → save を1回で実行
 */
export async function checkAndSave(
  session: B2Session,
  shipment: Shipment
): Promise<FeedEntry<Shipment>> {
  const checked = await checkShipment(session, shipment);
  return saveShipment(session, checked);
}

// ============================================================
// 保存済み伝票取得
// ============================================================

/**
 * 保存済み伝票一覧を取得
 *
 * @param session
 * @param serviceType 絞込するサービス種別（省略時は全部）
 */
export async function listSavedShipments(
  session: B2Session,
  serviceType?: ServiceType
): Promise<FeedEntry<Shipment>[]> {
  const query: Record<string, string> = {};
  if (serviceType !== undefined) {
    query.service_type = serviceType;
  }
  const res = await b2Get<Shipment>(session, '/b2/p/new', { query });
  return res.feed.entry ?? [];
}

/**
 * search_key4 で保存済み伝票を検索
 */
export async function findSavedBySearchKey4(
  session: B2Session,
  searchKey4: string,
  serviceType?: ServiceType
): Promise<FeedEntry<Shipment> | null> {
  const entries = await listSavedShipments(session, serviceType);
  return (
    entries.find((e) => e.shipment?.search_key4 === searchKey4) ?? null
  );
}

// ============================================================
// 保存済み伝票削除（論理削除）
// ============================================================

/**
 * 保存済み伝票を論理削除
 *
 * @param session
 * @param entries 削除対象のentry配列（id/link必須）
 */
export async function deleteSavedShipments(
  session: B2Session,
  entries: FeedEntry<Shipment>[]
): Promise<void> {
  await b2Put<Shipment>(
    session,
    '/b2/p/new',
    { feed: { entry: entries } },
    { query: { all: '', display_flg: '0' } }
  );
}

// ============================================================
// 履歴検索
// ============================================================

/**
 * 発行済み伝票の履歴を検索
 */
export async function searchHistory(
  session: B2Session,
  params: {
    searchKey4?: string;
    trackingNumber?: string;
    serviceType?: ServiceType;
    dateFrom?: string; // YYYY/MM/DD
    dateTo?: string; // YYYY/MM/DD
  }
): Promise<FeedEntry<Shipment>[]> {
  const query: Record<string, string> = { all: '' };

  if (params.searchKey4) query.search_key4 = params.searchKey4;
  if (params.trackingNumber) query.tracking_number = params.trackingNumber;
  if (params.serviceType) query.service_type = params.serviceType;
  if (params.dateFrom) query.date_from = params.dateFrom;
  if (params.dateTo) query.date_to = params.dateTo;

  const res = await b2Get<Shipment>(session, '/b2/p/history', { query });
  return res.feed.entry ?? [];
}

/**
 * 履歴を論理削除
 */
export async function deleteHistory(
  session: B2Session,
  entries: FeedEntry<Shipment>[]
): Promise<void> {
  await b2Put<Shipment>(
    session,
    '/b2/p/history',
    { feed: { entry: entries } },
    { query: { display_flg: '0' } }
  );
}
