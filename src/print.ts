/**
 * B2クラウド 印刷・PDF取得フロー
 *
 * ★実機検証済み完全フロー（2026-04-16）★
 *
 * === 新規印刷 (POST /new?issue) ===
 *   1. POST /b2/p/new?issue&print_type=X → issue_no払い出し
 *   2. GET  /b2/p/polling?issue_no=X → Success までリトライ
 *   3. GET  /b2/p/B2_OKURIJYO?checkonly=1 ★新規/再印刷ともに必須★
 *   4. GET  /b2/p/B2_OKURIJYO?fileonly=1 → PDF本体
 *      ★checkonly→fileonly のセット呼び出しが 12桁 tracking_number 割当の必須トリガー
 *      （設計書 E-5 #15・#16）
 *   5. GET  /b2/p/history?search_key4=X → 12桁追跡番号取得（リトライ必須）
 *
 * === 再印刷 (PUT /history?reissue) ===
 *   1. PUT  /b2/p/history?reissue → issue_no払い出し
 *   2. GET  /b2/p/polling → Success
 *   3. GET  /b2/p/B2_OKURIJYO?checkonly=1 ★必須★
 *   4. GET  /b2/p/B2_OKURIJYO?fileonly=1 → PDF本体
 *
 * === 実機計測された所要時間 ===
 *   checkonly      ~60ms
 *   save           ~200ms
 *   print issue    ~300ms
 *   polling (1回目) ~500ms
 *   PDF checkonly  ~200ms
 *   PDF download   ~300ms
 *   tracking取得   ~18秒 (18回retry)
 *   ──────────────────────
 *   合計            ~20秒
 *
 * @see docs/verification-results.md §4
 */

import {
  b2Get,
  b2GetBinary,
  b2Post,
  b2Put,
  isValidPdf,
  sleep,
  generateUniqueKey,
  B2CloudError,
} from './b2client';
import {
  checkShipment,
  saveShipment,
  findSavedBySearchKey4,
  searchHistory,
} from './shipment';
import type {
  B2Session,
  FeedEntry,
  Shipment,
  PrintType,
  PrinterType,
} from './types';

// ============================================================
// 定数
// ============================================================

/** デフォルト print_type */
export const DEFAULT_PRINT_TYPE: PrintType = 'm5';

/** デフォルト printer_type */
export const DEFAULT_PRINTER_TYPE: PrinterType = '1';

/** polling最大リトライ回数 */
export const POLLING_MAX_ATTEMPTS = 40;

/** polling間隔（ms） */
export const POLLING_INTERVAL_MS = 500;

/** tracking取得最大リトライ回数 */
export const TRACKING_MAX_ATTEMPTS = 30;

/** tracking取得間隔（ms） */
export const TRACKING_INTERVAL_MS = 1000;

// ============================================================
// 印刷ソートパラメータ（実機確認済み、必須）
// ============================================================

const PRINT_SORT_PARAMS = {
  sort1: 'service_type',
  sort2: 'created',
  sort3: 'created',
};

// ============================================================
// Step 1: 印刷実行（issue_no払い出し）
// ============================================================

/**
 * 保存済み伝票を印刷（issue_no払い出し）
 *
 * ★entry構造は id + link 両方必須、id末尾に ",{revision}" が必要★
 *
 * @param session
 * @param savedEntry saveShipment() の返り値
 * @param printType 印刷タイプ（デフォルト: m5）
 * @param printerType プリンタタイプ（デフォルト: '1'）
 * @returns issue_no
 */
export async function printIssue(
  session: B2Session,
  savedEntry: FeedEntry<Shipment>,
  printType: PrintType = DEFAULT_PRINT_TYPE,
  printerType: PrinterType = DEFAULT_PRINTER_TYPE
): Promise<string> {
  if (!savedEntry.link || savedEntry.link.length === 0) {
    throw new Error('print issue: link が必須');
  }

  const href = savedEntry.link[0].___href;
  const revision = '1'; // 新規印刷は常に revision=1

  const printEntry: FeedEntry<Shipment> = {
    id: `${href},${revision}`, // ★末尾に ",{revision}" 必須
    link: savedEntry.link, //       ★link も必須
    shipment: {
      ...savedEntry.shipment!,
      shipment_flg: '1', // ★発行指示
      printer_type: printerType,
    },
  };

  console.log('[printIssue] entry.id=' + printEntry.id);
  console.log('[printIssue] entry.link=' + JSON.stringify(printEntry.link));
  console.log('[printIssue] shipment_flg=' + printEntry.shipment?.shipment_flg +
    ' printer_type=' + printEntry.shipment?.printer_type +
    ' tracking=' + printEntry.shipment?.tracking_number);

  const res = await b2Post<Shipment>(
    session,
    '/b2/p/new',
    { feed: { entry: [printEntry] } },
    {
      query: {
        issue: '',
        print_type: printType,
        ...PRINT_SORT_PARAMS,
      },
    }
  );

  const issueNo = res.feed.title;
  if (!issueNo || issueNo === 'Error') {
    throw new B2CloudError(
      `print issue failed: title=${res.feed.title}`,
      500,
      JSON.stringify(res)
    );
  }

  return issueNo;
}

// ============================================================
// Step 2: polling（印刷処理完了確認）
// ============================================================

/**
 * polling で印刷完了を待つ
 *
 * ★設計書 4-1 / 4-10 で明記された仕様に準拠:
 *   GET /b2/p/polling?issue_no={no}&service_no=interman
 *
 *   service_no は固定値 'interman'。
 *   元JS のランダム文字列 randomFlg() は別の用途（ME0002 等のキャッシュバスティング）で
 *   使われていたものを混同していた。Node.js E2E 検証 (2026-04-16) で 'interman' 固定が
 *   実機で動作確認済み（4-10 のタイミング ~900ms 2回）。
 */
export async function pollUntilSuccess(
  session: B2Session,
  issueNo: string,
  maxAttempts: number = POLLING_MAX_ATTEMPTS,
  intervalMs: number = POLLING_INTERVAL_MS
): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await b2Get(session, '/b2/p/polling', {
      query: { issue_no: issueNo, service_no: 'interman' },
    });
    if (res.feed?.title === 'Success') {
      return i + 1; // 成功までの試行回数
    }
    await sleep(intervalMs);
  }
  throw new B2CloudError(
    `polling timeout: issue_no=${issueNo} after ${maxAttempts} attempts`,
    408
  );
}

// ============================================================
// Step 3-4: PDF取得（checkonly=1 → fileonly=1）
// ============================================================

/**
 * PDFダウンロード（2段構え）
 *
 * ★設計書 E-5 #15: checkonly=1 は新規/再印刷どちらでも必須★
 *   - 無しで fileonly=1 を呼ぶと 96B HTMLエラー (`<script>parent.location.href="/sys_err.html"</script>`)
 *   - 有り → 106KB PDF が返る
 *
 * ★設計書 E-5 #16: PDF取得 (checkonly→fileonly のセット) 自体が
 *   12桁 tracking_number 割当の必須トリガー★
 *   - PDF取得なし: 30秒retryしても tracking_number = 0/3
 *   - PDF取得あり: 1.4〜2.6秒で tracking_number = 3/3
 */
export async function downloadPdf(
  session: B2Session,
  issueNo: string
): Promise<Uint8Array> {
  // Step 3: checkonly=1 — ★必須、エラー時は中断（fileonly=1 が PDF を返す前提条件）
  await b2Get(session, '/b2/p/B2_OKURIJYO', {
    query: { checkonly: '1', issue_no: issueNo },
  });

  // Step 4: PDF本体ダウンロード
  const buf = await b2GetBinary(session, '/b2/p/B2_OKURIJYO', {
    query: { issue_no: issueNo, fileonly: '1' },
  });

  if (!isValidPdf(buf)) {
    // 96バイトのHTMLエラーレスポンス（sys_err.html リダイレクト等）
    const text = new TextDecoder().decode(buf.slice(0, 200));
    throw new B2CloudError(
      `PDF取得失敗: HTMLエラーが返りました (${buf.length}バイト): ${text}`,
      500,
      text
    );
  }

  return buf;
}

// ============================================================
// Step 5: 12桁追跡番号取得（リトライ必須）
// ============================================================

/**
 * search_key4 で履歴から 12桁追跡番号を取得（リトライ付き）
 *
 * ★実機では18回（約18秒）リトライで成功した例あり★
 */
export async function waitForTrackingNumber(
  session: B2Session,
  searchKey4: string,
  maxAttempts: number = TRACKING_MAX_ATTEMPTS,
  intervalMs: number = TRACKING_INTERVAL_MS
): Promise<{ trackingNumber: string; attempts: number } | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const entries = await searchHistory(session, { searchKey4 });
    const found = entries.find(
      (e) =>
        e.shipment?.search_key4 === searchKey4 &&
        typeof e.shipment?.tracking_number === 'string' &&
        /^\d{12}$/.test(e.shipment.tracking_number)
    );

    if (found?.shipment?.tracking_number) {
      return {
        trackingNumber: found.shipment.tracking_number,
        attempts: i + 1,
      };
    }

    await sleep(intervalMs);
  }

  return null;
}

// ============================================================
// 再印刷
// ============================================================

/**
 * 発行済み伝票を再印刷（reissue）
 *
 * @param session
 * @param historyEntry 発行済み伝票entry（searchHistory等から取得）
 * @param printType
 * @returns issue_no
 */
export async function reprintIssue(
  session: B2Session,
  historyEntry: FeedEntry<Shipment>,
  printType: PrintType = DEFAULT_PRINT_TYPE,
  printerType: PrinterType = DEFAULT_PRINTER_TYPE
): Promise<string> {
  if (!historyEntry.id || !historyEntry.link) {
    throw new Error('reprint: id と link が必須');
  }

  const reissueEntry: FeedEntry<Shipment> = {
    id: historyEntry.id, // history/xxx,{revision} 形式
    link: historyEntry.link,
    shipment: {
      ...historyEntry.shipment!,
      shipment_flg: '1',
      printer_type: printerType,
    },
  };

  const res = await b2Put<Shipment>(
    session,
    '/b2/p/history',
    { feed: { entry: [reissueEntry] } },
    {
      query: {
        reissue: '',
        print_type: printType,
        ...PRINT_SORT_PARAMS,
      },
    }
  );

  const issueNo = res.feed.title;
  if (!issueNo || issueNo === 'Error') {
    throw new B2CloudError(
      `reprint failed: ${JSON.stringify(res)}`,
      500
    );
  }

  return issueNo;
}

// ============================================================
// ★★★ フル E2E: 作成 → 保存 → 印刷 → PDF → 追跡番号 ★★★
// ============================================================

/**
 * フル E2E フロー: 伝票作成から追跡番号取得まで一括実行
 *
 * 実機検証済み（2026-04-16）:
 *   - uniqKey: TEST1776307799813
 *   - 内部管理番号: UMN240309577
 *   - issue_no: UMIN0001077958
 *   - 12桁追跡番号: 389711074012
 *   - PDF: 106KB
 *   - 合計所要時間: 約20秒
 *
 * @param session 確立済みセッション
 * @param shipment 伝票データ（search_key4は自動生成）
 * @param printType 印刷タイプ（デフォルト: m5 = A5マルチ）
 * @returns 印刷結果（PDF、追跡番号等）
 */
export async function createAndPrint(
  session: B2Session,
  shipment: Shipment,
  printType: PrintType = DEFAULT_PRINT_TYPE
): Promise<{
  /** ヤマト12桁追跡番号（取得できなかった場合は空） */
  trackingNumber: string;
  /** 追跡番号取得までのリトライ回数（失敗時は最大値） */
  trackingAttempts: number;
  /** 内部管理番号（UMN形式） */
  internalTracking: string;
  /** issue_no（UMIN形式） */
  issueNo: string;
  /** PDF本体 */
  pdf: Uint8Array;
  /** PDFサイズ（バイト） */
  pdfSize: number;
  /** polling試行回数 */
  pollingAttempts: number;
  /** 実際に使われた search_key4（shipment に含まれていない場合は自動生成値） */
  searchKey4: string;
}> {
  // ★追跡番号取得のためのユニークキーを確実に設定
  const searchKey4 = shipment.search_key4 ?? generateUniqueKey('API');
  const shipmentWithKey: Shipment = {
    ...shipment,
    search_key4: searchKey4,
    search_key_title4: shipment.search_key_title4 ?? 'API',
  };

  // Step 1: check
  console.log('[createAndPrint] Step 1: check start');
  const checked = await checkShipment(session, shipmentWithKey);
  console.log('[createAndPrint] Step 1: check OK, error_flg=' + checked.shipment?.error_flg);

  // Step 2: save
  console.log('[createAndPrint] Step 2: save start');
  const saved = await saveShipment(session, checked);
  const internalTracking = saved.shipment?.tracking_number ?? '';
  console.log('[createAndPrint] Step 2: save OK, tracking=' + internalTracking +
    ', link=' + JSON.stringify(saved.link?.[0]) +
    ', id=' + saved.id);

  // Step 3: print issue
  console.log('[createAndPrint] Step 3: printIssue start, printType=' + printType);
  const issueNo = await printIssue(session, saved, printType);
  console.log('[createAndPrint] Step 3: printIssue OK, issueNo=' + issueNo);

  // Step 4: polling
  console.log('[createAndPrint] Step 4: polling start');
  const pollingAttempts = await pollUntilSuccess(session, issueNo);
  console.log('[createAndPrint] Step 4: polling OK, attempts=' + pollingAttempts);

  // Step 5: PDF download (checkonly=1 → fileonly=1)
  console.log('[createAndPrint] Step 5: PDF download start');
  const pdf = await downloadPdf(session, issueNo);
  console.log('[createAndPrint] Step 5: PDF OK, size=' + pdf.length);

  // Step 6: tracking number (retry必須)
  console.log('[createAndPrint] Step 6: tracking start');
  const trackResult = await waitForTrackingNumber(session, searchKey4);
  console.log('[createAndPrint] Step 6: tracking OK, number=' + trackResult?.trackingNumber);

  return {
    trackingNumber: trackResult?.trackingNumber ?? '',
    trackingAttempts: trackResult?.attempts ?? TRACKING_MAX_ATTEMPTS,
    internalTracking,
    issueNo,
    pdf,
    pdfSize: pdf.length,
    pollingAttempts,
    searchKey4,
  };
}

// ============================================================
// 再印刷フル E2E
// ============================================================

/**
 * 発行済み伝票の再印刷フルフロー
 *
 * @param session
 * @param searchKey4OrTrackingNumber 検索キー4 または 12桁追跡番号
 * @param printType
 */
export async function reprintFullFlow(
  session: B2Session,
  searchKey4OrTrackingNumber: string,
  printType: PrintType = DEFAULT_PRINT_TYPE
): Promise<{
  pdf: Uint8Array;
  pdfSize: number;
  issueNo: string;
  pollingAttempts: number;
}> {
  // 履歴検索
  const entries = await searchHistory(session, {
    // 12桁数字なら tracking_number、それ以外は search_key4 として扱う
    ...(/^\d{12}$/.test(searchKey4OrTrackingNumber)
      ? { trackingNumber: searchKey4OrTrackingNumber }
      : { searchKey4: searchKey4OrTrackingNumber }),
  });

  if (entries.length === 0) {
    throw new Error(`対象伝票が見つかりません: ${searchKey4OrTrackingNumber}`);
  }

  const target = entries[0];

  // 再印刷
  const issueNo = await reprintIssue(session, target, printType);

  // polling
  const pollingAttempts = await pollUntilSuccess(session, issueNo);

  // PDF （★再印刷時は checkonly=1 必須、downloadPdf 内で実行）
  const pdf = await downloadPdf(session, issueNo);

  return { pdf, pdfSize: pdf.length, issueNo, pollingAttempts };
}
