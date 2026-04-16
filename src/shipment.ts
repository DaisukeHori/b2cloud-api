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
 * 4. deleteSavedShipments() → DELETE /b2/p/new (msgpack+zlib body)
 *    - 保存済み伝票を物理削除（発行前のみ可能、設計書 4-11 / E-4 #13）
 *    - 発行済み履歴の削除 API は存在しない（E-4 #14）
 */

import { b2Get, b2Post, b2Put, b2Delete, B2ValidationError } from './b2client';
import type {
  B2Session,
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
// 保存済み伝票削除（★DELETE /b2/p/new、msgpack+zlib 必須、設計書 4-11）
// ============================================================

/**
 * 保存済み伝票を削除（1件〜複数件を1リクエストで一括削除可能）
 *
 * ★設計書 4-11 参照。ブラウザUIも UI から 19件一括削除を確認。
 *   - URL: DELETE /b2/p/new（クエリなし）
 *   - Body: msgpack+zlib 圧縮された feed（id + link + shipment）
 *   - ★ JSON body では 409 or no-op（実削除されない）
 *
 * @param session
 * @param entries 削除対象のentry配列（id/link必須）
 */
export async function deleteSavedShipments(
  session: B2Session,
  entries: FeedEntry<Shipment>[]
): Promise<void> {
  if (entries.length === 0) return;

  // 削除用 entry は id + link + shipment（link[0].___href から id を再構築）
  const deleteEntries = entries.map((e) => {
    if (!e.link || e.link.length === 0) {
      throw new Error('delete: link[0].___href が必須');
    }
    return {
      id: e.id ?? e.link[0].___href,
      link: e.link,
      shipment: e.shipment,
    };
  });

  const res = await b2Delete<Shipment>(
    session,
    '/b2/p/new',
    { feed: { entry: deleteEntries } },
    { throwOnFeedError: false }
  );

  // 期待レスポンス: {"feed":{"title":"Deleted.","entry":[{"system_date":{...}}]}}
  if (res.feed?.title && res.feed.title !== 'Deleted.') {
    throw new Error(`DELETE /b2/p/new failed: ${JSON.stringify(res.feed)}`);
  }
}

// ============================================================
// 履歴検索
// ============================================================

/**
 * 発行済み伝票の履歴を検索
 *
 * ★元JS実装 (main-9d4c7b2348.js @250719) 準拠:
 *   元JS の history 検索クエリは
 *   `?dmnumberlistinfo&issued_date-ge-YYYYMMDDhhmmss&issued_date-le-YYYYMMDDhhmmss
 *    &is_printing_logout=0&service_type=N`
 *   のような具体的フィルタ列。`?all` のような汎用クエリは元JSに存在しない。
 *
 *   本実装は search_key4 / tracking_number / 期間 / service_type の組合せを
 *   サーバー側でフィルタする。クエリパラメータが何も無い場合は全件返却される
 *   （実機検証済み）。
 */
export async function searchHistory(
  session: B2Session,
  params: {
    searchKey4?: string;
    trackingNumber?: string;
    serviceType?: ServiceType;
    /** YYYY/MM/DD or YYYYMMDD */
    dateFrom?: string;
    /** YYYY/MM/DD or YYYYMMDD */
    dateTo?: string;
  }
): Promise<FeedEntry<Shipment>[]> {
  // ★設計書 4-1 / 4-10 で明記された必須クエリ ?all
  //   GET /b2/p/history?all                       — 全履歴取得
  //   GET /b2/p/history?all&tracking_number={tn}  — 追跡番号検索
  //   GET /b2/p/history?all&search_key4={key}     — 検索キー検索
  //   ?all を省略すると履歴が返らない/違うレスポンスになる（実機検証済）
  const query: Record<string, string> = { all: '' };

  if (params.searchKey4) query.search_key4 = params.searchKey4;
  if (params.trackingNumber) query.tracking_number = params.trackingNumber;
  if (params.serviceType) query.service_type = params.serviceType;
  if (params.dateFrom) query.date_from = params.dateFrom;
  if (params.dateTo) query.date_to = params.dateTo;

  const res = await b2Get<Shipment>(session, '/b2/p/history', { query });
  return res.feed.entry ?? [];
}

// ============================================================
// 注: 発行済み履歴の削除 API は B2クラウドに存在しない
// ============================================================
//
// ★設計書 E-4 #14 で確定:
//   - ブラウザ UI に発行済み履歴の削除ボタンは存在しない
//   - 元JS (main-9d4c7b2348.js) に該当コード無し
//   - サーバー側に該当エンドポイントが提供されていないと推定
//
// 仕様: 発行済み伝票は削除不可。`PUT /b2/p/history?display_flg=0` のような
// 推測 API は存在しないため、本ファイルから関数自体を削除している。
