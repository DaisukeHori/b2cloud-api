/**
 * 高レベル API: 伝票作成・印刷・PDF取得・追跡番号取得の一括フロー
 *
 * ★実機検証済み完全フロー（2026-04-16、設計書 4-8 参照）★
 *
 * このモジュールは src/print.ts から createAndPrint / reprintFullFlow / downloadPdf など
 * のフル E2E 関数を再エクスポートし、設計書 11章「実装計画 Phase 1」の命名
 * （`src/createAndPrint.ts`）に合わせた公開面を提供する。
 *
 * 呼び出し側は:
 *   import { createAndPrint, reprintFullFlow } from './createAndPrint';
 *
 * 実装本体は src/print.ts（createAndPrint / reprintIssue / downloadPdf / polling）を参照。
 *
 * @see docs/b2cloud-design.md §4-8 createAndPrint
 * @see docs/b2cloud-design.md §4-5 PDF取得の2段構え
 * @see docs/b2cloud-design.md §4-7 再印刷と checkonly=1 必須性
 */

export {
  createAndPrint,
  reprintFullFlow,
  reprintIssue,
  printIssue,
  downloadPdf,
  pollUntilSuccess,
  waitForTrackingNumber,
  DEFAULT_PRINT_TYPE,
  DEFAULT_PRINTER_TYPE,
  POLLING_MAX_ATTEMPTS,
  POLLING_INTERVAL_MS,
  TRACKING_MAX_ATTEMPTS,
  TRACKING_INTERVAL_MS,
} from './print';
