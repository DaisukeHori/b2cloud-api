import { defineConfig } from 'vitest/config';

/**
 * E2E テスト専用設定
 *
 * ★実 B2クラウド (newb2web.kuronekoyamato.co.jp) への接続が必要★
 *
 * 実行方法:
 *   1. .env を準備（B2_CUSTOMER_CODE / B2_CUSTOMER_PASSWORD 必須）
 *   2. 軽量テスト (発行しない):
 *        npm run test:e2e
 *      → B2_E2E_ENABLED=1 で auth/check/save/delete のみ実行
 *
 *   3. フル E2E (★実際に伝票を発行★):
 *        npm run test:e2e:full
 *      → B2_E2E_FULL=1 で印刷・PDF取得・追跡番号取得まで実行
 *      → B2クラウド側に印刷ジョブが発行され 12桁追跡番号が割り当てられる
 *      → テスト終了時に削除しないので残る点に注意
 *
 * テスト同士で削除済み伝票や同名 search_key4 が衝突しないよう、
 * 各 test ファイルは search_key4 をユニーク化（generateUniqueKey）して使う。
 *
 * 並列実行は B2クラウド側のレート制限を考慮してシリアル化（pool: 'forks',
 * singleFork: true）。
 */
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.test.ts'],
    exclude: ['node_modules/**'],
    globals: true,
    // 実通信なのでタイムアウトは長めに
    // - 認証 (3-5秒) + check (200ms) + save (200ms) + print (300ms)
    //   + polling (500ms × 数回) + PDF取得 (500ms) + tracking (最大30秒) = 約40秒
    testTimeout: 90_000,
    hookTimeout: 30_000,
    // B2クラウド側を負荷で叩かないようテストはシリアル実行
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // setupFiles で .env を読む
    setupFiles: ['./tests/e2e/setup.ts'],
    // E2E はデフォルトでは実行されない（環境変数ガード必須）
    // 個別 test ファイル内で `describe.skipIf(...)` で制御する
  },
});
