/**
 * 結合テスト用のモックセットアップ
 *
 * `undici.MockAgent` を使って B2クラウドのHTTPレスポンスをモックし、
 * ネットワークアクセスなしで shipment/print/settings の全フローをテストする。
 */

import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, Dispatcher } from 'undici';
import { CookieJar } from 'tough-cookie';
import type { B2Session } from '../../src/types';

// ============================================================
// MockAgent のインスタンス管理
// ============================================================

let mockAgent: MockAgent | null = null;
let originalDispatcher: Dispatcher | null = null;

/**
 * MockAgent を有効化（beforeAll / beforeEach で呼ぶ）
 */
export function startMock(): MockAgent {
  originalDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  return mockAgent;
}

/**
 * MockAgent を無効化（afterAll / afterEach で呼ぶ）
 */
export async function stopMock(): Promise<void> {
  if (mockAgent) {
    await mockAgent.close();
    mockAgent = null;
  }
  if (originalDispatcher) {
    setGlobalDispatcher(originalDispatcher);
    originalDispatcher = null;
  }
}

/**
 * 現在の MockAgent を取得
 */
export function getMock(): MockAgent {
  if (!mockAgent) {
    throw new Error('MockAgent is not started. Call startMock() first.');
  }
  return mockAgent;
}

// ============================================================
// テスト用 B2Session ファクトリ
// ============================================================

/**
 * テスト用のダミーセッション
 * ログインを経由せずに作成する（MockAgent 前提）
 */
export function makeTestSession(overrides: Partial<B2Session> = {}): B2Session {
  return {
    baseUrl: 'https://newb2web.kuronekoyamato.co.jp',
    cookieJar: new CookieJar(),
    template: [
      'shipment{}',
      ' service_type!',
      ' consignee_name',
      ' consignee_telephone_display',
      ' consignee_zip_code',
      ' shipment_date',
    ],
    customerCode: '0482540070',
    customerPassword: 'testpass',
    loginAt: new Date(),
    ...overrides,
  };
}

// ============================================================
// レスポンスファクトリ
// ============================================================

/**
 * 成功レスポンス（feed）を組立
 */
export function feedResponse(entries: any[] = [], opts: { title?: string; updated?: string } = {}) {
  return {
    feed: {
      ...(opts.title ? { title: opts.title } : {}),
      ...(opts.updated ? { updated: opts.updated } : {}),
      entry: entries,
    },
  };
}

/**
 * エラーレスポンス（feed.title = "Error"）
 */
export function errorFeedResponse(errors: { code: string; property: string; description: string }[]) {
  return {
    feed: {
      title: 'Error',
      entry: errors.map((e) => ({
        error: [
          {
            error_code: e.code,
            error_property_name: e.property,
            error_description: e.description,
          },
        ],
      })),
    },
  };
}

/**
 * checkonly レスポンスの shipment 部分（error_flg='0' 付与）
 */
export function mockShipmentEntry(shipment: Partial<any> = {}) {
  return {
    id: '/0482540070-/new/UMN' + Math.random().toString(36).slice(2, 9),
    link: [
      {
        ___href: '/0482540070-/new/UMN' + Math.random().toString(36).slice(2, 9),
      },
    ],
    shipment: {
      service_type: '0',
      consignee_name: 'テスト太郎',
      consignee_telephone_display: '03-1234-5678',
      consignee_zip_code: '100-0001',
      consignee_address1: '東京都',
      consignee_address2: '千代田区',
      consignee_address3: '1-1',
      shipment_date: '2026/04/20',
      error_flg: '0',
      tracking_number: 'UMN240309577',
      ...shipment,
    },
  };
}

/**
 * サンプル PDF バイト列
 */
export const SAMPLE_PDF = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, // %PDF-1.7
  0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a, // ...
  ...Array.from({ length: 200 }, (_, i) => i & 0xff),
]);

/**
 * HTML エラーレスポンス（sys_err.html リダイレクト）
 */
export const SAMPLE_HTML_ERR = new TextEncoder().encode(
  '<html><script>parent.location.href="/sys_err.html"</script></html>'
);
