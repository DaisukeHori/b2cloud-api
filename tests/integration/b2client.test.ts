/**
 * b2client.ts 結合テスト（MockAgent で HTTP 層をモック）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  b2Get,
  b2Post,
  b2Put,
  b2Delete,
  b2GetBinary,
  b2Request,
  B2CloudError,
  B2ValidationError,
  B2SessionExpiredError,
} from '../../src/b2client';
import {
  startMock,
  stopMock,
  getMock,
  makeTestSession,
  feedResponse,
  errorFeedResponse,
  SAMPLE_PDF,
} from './setup';

const BASE_URL = 'https://newb2web.kuronekoyamato.co.jp';

beforeEach(() => {
  startMock();
});

afterEach(async () => {
  await stopMock();
});

/**
 * ヘッダキャプチャ用のインターセプト（callback 形式）
 *
 * mockAgent.reply(callback) は opts.headers / opts.body を受け取る
 */
function interceptWithCapture(
  path: string,
  method: string,
  replyBuilder: (opts: { headers: Record<string, string>; body: unknown }) => {
    statusCode: number;
    data: any;
    responseOptions?: any;
  }
) {
  return getMock()
    .get(BASE_URL)
    .intercept({ path, method })
    .reply((opts: any) => {
      const headers =
        typeof opts.headers === 'object' && !Array.isArray(opts.headers) && opts.headers !== null
          ? (opts.headers as Record<string, string>)
          : {};
      const lowered: Record<string, string> = {};
      for (const k of Object.keys(headers)) {
        lowered[k.toLowerCase()] = String((headers as any)[k]);
      }
      return replyBuilder({ headers: lowered, body: opts.body });
    });
}

// ============================================================
// b2Get
// ============================================================

describe('b2Get', () => {
  it('200 OK の feed を返す', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'GET' })
      .reply(200, feedResponse([]));
    const res = await b2Get(makeTestSession(), '/b2/p/new');
    expect(res.feed).toBeDefined();
  });

  it('クエリパラメータが URL に付く', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new?service_type=0', method: 'GET' })
      .reply(200, feedResponse([]));
    const res = await b2Get(makeTestSession(), '/b2/p/new', { query: { service_type: '0' } });
    expect(res.feed).toBeDefined();
  });

  it('空文字クエリでもパスに ?key= が付く', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new?all=', method: 'GET' })
      .reply(200, feedResponse([]));
    const res = await b2Get(makeTestSession(), '/b2/p/new', { query: { all: '' } });
    expect(res.feed).toBeDefined();
  });

  it('複数クエリパラメータ', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/history?search_key4=KEY&service_type=0', method: 'GET' })
      .reply(200, feedResponse([]));
    const res = await b2Get(makeTestSession(), '/b2/p/history', {
      query: { search_key4: 'KEY', service_type: '0' },
    });
    expect(res.feed).toBeDefined();
  });

  it('Cookie ヘッダが付与される', async () => {
    const session = makeTestSession();
    await session.cookieJar.setCookie('b2sid=abc123; Path=/', BASE_URL);
    let gotCookie = '';
    interceptWithCapture('/b2/p/new', 'GET', ({ headers }) => {
      gotCookie = headers.cookie ?? '';
      return { statusCode: 200, data: JSON.stringify(feedResponse([])) };
    });
    await b2Get(session, '/b2/p/new');
    expect(gotCookie).toContain('b2sid=abc123');
  });

  it('Origin ヘッダが付与される', async () => {
    let gotOrigin = '';
    interceptWithCapture('/b2/p/new', 'GET', ({ headers }) => {
      gotOrigin = headers.origin ?? '';
      return { statusCode: 200, data: JSON.stringify(feedResponse([])) };
    });
    await b2Get(makeTestSession(), '/b2/p/new');
    expect(gotOrigin).toBe(BASE_URL);
  });

  it('Referer ヘッダが /single_issue_reg.html を指す', async () => {
    let gotReferer = '';
    interceptWithCapture('/b2/p/new', 'GET', ({ headers }) => {
      gotReferer = headers.referer ?? '';
      return { statusCode: 200, data: JSON.stringify(feedResponse([])) };
    });
    await b2Get(makeTestSession(), '/b2/p/new');
    expect(gotReferer).toContain('/single_issue_reg.html');
  });

  it('X-Requested-With: XMLHttpRequest', async () => {
    let got = '';
    interceptWithCapture('/b2/p/new', 'GET', ({ headers }) => {
      got = headers['x-requested-with'] ?? '';
      return { statusCode: 200, data: JSON.stringify(feedResponse([])) };
    });
    await b2Get(makeTestSession(), '/b2/p/new');
    expect(got).toBe('XMLHttpRequest');
  });

  it('User-Agent がブラウザ互換', async () => {
    let got = '';
    interceptWithCapture('/b2/p/new', 'GET', ({ headers }) => {
      got = headers['user-agent'] ?? '';
      return { statusCode: 200, data: JSON.stringify(feedResponse([])) };
    });
    await b2Get(makeTestSession(), '/b2/p/new');
    expect(got).toContain('Mozilla');
  });

  it('Accept ヘッダが application/json', async () => {
    let got = '';
    interceptWithCapture('/b2/p/new', 'GET', ({ headers }) => {
      got = headers.accept ?? '';
      return { statusCode: 200, data: JSON.stringify(feedResponse([])) };
    });
    await b2Get(makeTestSession(), '/b2/p/new');
    expect(got).toContain('application/json');
  });

  it('feed.title="Error" なら B2ValidationError をスロー', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'GET' })
      .reply(
        200,
        errorFeedResponse([
          { code: 'EF011001', property: 'consignee_name', description: 'お届け先名必須' },
        ])
      );
    await expect(b2Get(makeTestSession(), '/b2/p/new')).rejects.toThrow(B2ValidationError);
  });

  it('throwOnFeedError=false なら Error feed でもスローしない', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'GET' })
      .reply(200, errorFeedResponse([{ code: 'EF011001', property: 'x', description: 'err' }]));
    const res = await b2Get(makeTestSession(), '/b2/p/new', { throwOnFeedError: false });
    expect(res.feed.title).toBe('Error');
  });

  it('404 は B2CloudError', async () => {
    getMock().get(BASE_URL).intercept({ path: '/b2/p/notfound', method: 'GET' }).reply(404, '');
    await expect(b2Get(makeTestSession(), '/b2/p/notfound')).rejects.toThrow(B2CloudError);
  });

  it('500 はリトライされ、maxRetries=0 なら即エラー', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'GET' })
      .reply(500, 'err')
      .persist();
    await expect(b2Get(makeTestSession(), '/b2/p/new', { maxRetries: 0 })).rejects.toThrow();
  });

  it('HTML レスポンス（sys_err.html）はエラー', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'GET' })
      .reply(200, '<html><body>error</body></html>');
    await expect(b2Get(makeTestSession(), '/b2/p/new')).rejects.toThrow(B2CloudError);
  });

  it('不正な JSON は B2CloudError', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'GET' })
      .reply(200, '{invalid json');
    await expect(b2Get(makeTestSession(), '/b2/p/new')).rejects.toThrow(B2CloudError);
  });

  it('空レスポンス（200）は空 feed を返す', async () => {
    getMock().get(BASE_URL).intercept({ path: '/b2/p/new', method: 'GET' }).reply(200, '');
    const res = await b2Get(makeTestSession(), '/b2/p/new');
    expect(res.feed.entry).toEqual([]);
  });

  it('空レスポンス（400）は B2CloudError', async () => {
    getMock().get(BASE_URL).intercept({ path: '/b2/p/new', method: 'GET' }).reply(400, '');
    await expect(b2Get(makeTestSession(), '/b2/p/new')).rejects.toThrow(B2CloudError);
  });

  it('feed に entry が複数あれば配列で返る', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'GET' })
      .reply(
        200,
        feedResponse([
          { shipment: { service_type: '0' } },
          { shipment: { service_type: '1' } },
        ])
      );
    const res = await b2Get(makeTestSession(), '/b2/p/new');
    expect(res.feed.entry).toHaveLength(2);
  });

  it('カスタムヘッダが送信される', async () => {
    let got = '';
    interceptWithCapture('/b2/p/new', 'GET', ({ headers }) => {
      got = headers['x-test'] ?? '';
      return { statusCode: 200, data: JSON.stringify(feedResponse([])) };
    });
    await b2Get(makeTestSession(), '/b2/p/new', { headers: { 'X-Test': 'value1' } });
    expect(got).toBe('value1');
  });

  it('Set-Cookie が Cookie jar に保存される', async () => {
    const session = makeTestSession();
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'GET' })
      .reply(200, JSON.stringify(feedResponse([])), {
        headers: { 'set-cookie': 'newcookie=value; Path=/' },
      });
    await b2Get(session, '/b2/p/new');
    const cookies = await session.cookieJar.getCookieString(BASE_URL);
    expect(cookies).toContain('newcookie=value');
  });
});

// ============================================================
// b2Post
// ============================================================

describe('b2Post', () => {
  it('JSON body が送信される', async () => {
    let gotBody: any = null;
    interceptWithCapture('/b2/p/new', 'POST', ({ body }) => {
      gotBody = body;
      return { statusCode: 200, data: JSON.stringify(feedResponse([])) };
    });
    await b2Post(makeTestSession(), '/b2/p/new', { feed: { entry: [] } });
    expect(String(gotBody)).toContain('"feed"');
  });

  it('Content-Type は application/json', async () => {
    let got = '';
    interceptWithCapture('/b2/p/new', 'POST', ({ headers }) => {
      got = headers['content-type'] ?? '';
      return { statusCode: 200, data: JSON.stringify(feedResponse([])) };
    });
    await b2Post(makeTestSession(), '/b2/p/new', { feed: { entry: [] } });
    expect(got).toBe('application/json');
  });

  it('checkonly クエリ付きで送信できる', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new?checkonly=', method: 'POST' })
      .reply(200, feedResponse([]));
    const res = await b2Post(makeTestSession(), '/b2/p/new', {}, { query: { checkonly: '' } });
    expect(res.feed).toBeDefined();
  });

  it('useMsgpack=true なら Content-Type が msgpack', async () => {
    let gotCT = '';
    let gotCE = '';
    interceptWithCapture('/b2/p/new', 'POST', ({ headers }) => {
      gotCT = headers['content-type'] ?? '';
      gotCE = headers['content-encoding'] ?? '';
      return { statusCode: 200, data: JSON.stringify(feedResponse([])) };
    });
    await b2Post(makeTestSession(), '/b2/p/new', { feed: { entry: [] } }, { useMsgpack: true });
    expect(gotCT).toContain('x-msgpack');
    expect(gotCE).toBe('deflate');
  });

  it('useMsgpack=false（デフォルト）なら JSON', async () => {
    let got = '';
    interceptWithCapture('/b2/p/new', 'POST', ({ headers }) => {
      got = headers['content-type'] ?? '';
      return { statusCode: 200, data: JSON.stringify(feedResponse([])) };
    });
    await b2Post(makeTestSession(), '/b2/p/new', { feed: { entry: [] } });
    expect(got).toBe('application/json');
  });

  it('200 OK で feed を返す', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'POST' })
      .reply(200, feedResponse([{ shipment: { tracking_number: 'UMN123' } }]));
    const res = await b2Post(makeTestSession(), '/b2/p/new', { feed: {} });
    expect(res.feed.entry?.[0].shipment?.tracking_number).toBe('UMN123');
  });

  it('feed.title=Error なら B2ValidationError', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'POST' })
      .reply(200, errorFeedResponse([{ code: 'E', property: 'p', description: 'd' }]));
    await expect(b2Post(makeTestSession(), '/b2/p/new', {})).rejects.toThrow(B2ValidationError);
  });

  it('B2ValidationError は error 配列を保持', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'POST' })
      .reply(
        200,
        errorFeedResponse([
          { code: 'E1', property: 'p1', description: 'desc1' },
          { code: 'E2', property: 'p2', description: 'desc2' },
        ])
      );
    try {
      await b2Post(makeTestSession(), '/b2/p/new', {});
      expect.fail('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(B2ValidationError);
      expect((e as B2ValidationError).errors).toHaveLength(2);
    }
  });

  it('400 HTTP エラーは B2CloudError', async () => {
    getMock().get(BASE_URL).intercept({ path: '/b2/p/new', method: 'POST' }).reply(400, '{}');
    await expect(b2Post(makeTestSession(), '/b2/p/new', {})).rejects.toThrow(B2CloudError);
  });

  it('409 Conflict は B2CloudError', async () => {
    getMock().get(BASE_URL).intercept({ path: '/b2/p/new', method: 'POST' }).reply(409, '{}');
    await expect(b2Post(makeTestSession(), '/b2/p/new', {})).rejects.toThrow(B2CloudError);
  });

  it('issue クエリパラメータを送信', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new?issue=&print_type=m5', method: 'POST' })
      .reply(200, { feed: { title: 'UMIN0001077958' } });
    const res = await b2Post(makeTestSession(), '/b2/p/new', {}, {
      query: { issue: '', print_type: 'm5' },
    });
    expect(res.feed.title).toBe('UMIN0001077958');
  });

  it('500 リトライ後に成功', async () => {
    let count = 0;
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'POST' })
      .reply(() => {
        count++;
        return count < 2
          ? { statusCode: 500, data: '' }
          : { statusCode: 200, data: JSON.stringify(feedResponse([])) };
      })
      .persist();
    await b2Post(makeTestSession(), '/b2/p/new', {}, { maxRetries: 3 });
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// b2Put
// ============================================================

describe('b2Put', () => {
  it('PUT メソッドで送信される', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/settings', method: 'PUT' })
      .reply(200, feedResponse([]));
    const res = await b2Put(makeTestSession(), '/b2/p/settings', {});
    expect(res.feed).toBeDefined();
  });

  it('PUT はデフォルト JSON', async () => {
    let got = '';
    interceptWithCapture('/b2/p/settings', 'PUT', ({ headers }) => {
      got = headers['content-type'] ?? '';
      return { statusCode: 200, data: JSON.stringify(feedResponse([])) };
    });
    await b2Put(makeTestSession(), '/b2/p/settings', {});
    expect(got).toBe('application/json');
  });

  it('reissue クエリで再印刷リクエスト', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/history?reissue=&print_type=m5', method: 'PUT' })
      .reply(200, { feed: { title: 'UMIN0002' } });
    const res = await b2Put(makeTestSession(), '/b2/p/history', {}, {
      query: { reissue: '', print_type: 'm5' },
    });
    expect(res.feed.title).toBe('UMIN0002');
  });

  it('PUT 500 はリトライされる', async () => {
    let count = 0;
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/settings', method: 'PUT' })
      .reply(() => {
        count++;
        return count < 2
          ? { statusCode: 500, data: '' }
          : { statusCode: 200, data: JSON.stringify(feedResponse([])) };
      })
      .persist();
    await b2Put(makeTestSession(), '/b2/p/settings', {}, { maxRetries: 3 });
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('PUT で useMsgpack=true も動作', async () => {
    let got = '';
    interceptWithCapture('/b2/p/settings', 'PUT', ({ headers }) => {
      got = headers['content-type'] ?? '';
      return { statusCode: 200, data: JSON.stringify(feedResponse([])) };
    });
    await b2Put(makeTestSession(), '/b2/p/settings', { feed: {} }, { useMsgpack: true });
    expect(got).toContain('msgpack');
  });
});

// ============================================================
// b2Delete
// ============================================================

describe('b2Delete', () => {
  it('DELETE は自動で msgpack+zlib', async () => {
    let gotCT = '';
    let gotCE = '';
    interceptWithCapture('/b2/p/new', 'DELETE', ({ headers }) => {
      gotCT = headers['content-type'] ?? '';
      gotCE = headers['content-encoding'] ?? '';
      return {
        statusCode: 200,
        data: JSON.stringify(feedResponse([], { title: 'Deleted.' })),
      };
    });
    await b2Delete(
      makeTestSession(),
      '/b2/p/new',
      { feed: { entry: [{ shipment: { service_type: '0' } }] } },
      { throwOnFeedError: false }
    );
    expect(gotCT).toContain('msgpack');
    expect(gotCE).toBe('deflate');
  });

  it('useMsgpack=false 明示で JSON になる', async () => {
    let got = '';
    interceptWithCapture('/b2/p/new', 'DELETE', ({ headers }) => {
      got = headers['content-type'] ?? '';
      return {
        statusCode: 200,
        data: JSON.stringify(feedResponse([], { title: 'Deleted.' })),
      };
    });
    await b2Delete(
      makeTestSession(),
      '/b2/p/new',
      { feed: {} },
      { useMsgpack: false, throwOnFeedError: false }
    );
    expect(got).toBe('application/json');
  });

  it('DELETE 200 / feed.title=Deleted. は成功', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'DELETE' })
      .reply(200, feedResponse([{ system_date: { sys_date: '20260416' } }], { title: 'Deleted.' }));
    const res = await b2Delete(makeTestSession(), '/b2/p/new', {}, { throwOnFeedError: false });
    expect(res.feed.title).toBe('Deleted.');
  });

  it('DELETE は 409 Conflict を返すことも', async () => {
    getMock().get(BASE_URL).intercept({ path: '/b2/p/new', method: 'DELETE' }).reply(409, '{}');
    await expect(b2Delete(makeTestSession(), '/b2/p/new', {})).rejects.toThrow(B2CloudError);
  });
});

// ============================================================
// b2GetBinary
// ============================================================

describe('b2GetBinary', () => {
  it('PDF バイナリを取得', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/B2_OKURIJYO?fileonly=1', method: 'GET' })
      .reply(200, Buffer.from(SAMPLE_PDF), {
        headers: { 'content-type': 'application/pdf' },
      });
    const buf = await b2GetBinary(makeTestSession(), '/b2/p/B2_OKURIJYO', {
      query: { fileonly: '1' },
    });
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(buf[0]).toBe(0x25);
    expect(buf[1]).toBe(0x50);
  });

  it('400 のバイナリ取得は B2CloudError', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/B2_OKURIJYO', method: 'GET' })
      .reply(400, Buffer.from('error page'));
    await expect(b2GetBinary(makeTestSession(), '/b2/p/B2_OKURIJYO')).rejects.toThrow(B2CloudError);
  });

  it('404 のバイナリ取得は B2CloudError', async () => {
    getMock().get(BASE_URL).intercept({ path: '/b2/p/pdf', method: 'GET' }).reply(404, '');
    await expect(b2GetBinary(makeTestSession(), '/b2/p/pdf')).rejects.toThrow(B2CloudError);
  });
});

// ============================================================
// 認証関連（onReauthenticate）
// ============================================================

describe('onReauthenticate コールバック', () => {
  it('401 → onReauthenticate 呼ばれる', async () => {
    let called = 0;
    let phase = 0;
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'GET' })
      .reply(() => {
        phase++;
        return phase === 1
          ? { statusCode: 401, data: '' }
          : { statusCode: 200, data: JSON.stringify(feedResponse([])) };
      })
      .persist();

    await b2Get(makeTestSession(), '/b2/p/new', {
      onReauthenticate: async () => {
        called++;
      },
    });

    expect(called).toBe(1);
  });

  it('403 → onReauthenticate 呼ばれる', async () => {
    let called = 0;
    let phase = 0;
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'GET' })
      .reply(() => {
        phase++;
        return phase === 1
          ? { statusCode: 403, data: '' }
          : { statusCode: 200, data: JSON.stringify(feedResponse([])) };
      })
      .persist();

    await b2Get(makeTestSession(), '/b2/p/new', {
      onReauthenticate: async () => {
        called++;
      },
    });

    expect(called).toBe(1);
  });

  it('onReauthenticate なしの 401 は HTML なら B2SessionExpiredError', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/new', method: 'GET' })
      .reply(401, '<html>expired</html>');
    await expect(b2Get(makeTestSession(), '/b2/p/new')).rejects.toThrow(B2SessionExpiredError);
  });
});

// ============================================================
// b2Request 直接呼び出し
// ============================================================

describe('b2Request', () => {
  it('binary=true でバイナリ取得', async () => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/test', method: 'GET' })
      .reply(200, Buffer.from(SAMPLE_PDF));
    const res = await b2Request(makeTestSession(), '/b2/p/test', 'GET', undefined, { binary: true });
    expect(res).toBeInstanceOf(Uint8Array);
  });

  it('GET に body を渡しても無視される', async () => {
    let gotBody: any = null;
    interceptWithCapture('/b2/p/test', 'GET', ({ body }) => {
      gotBody = body;
      return { statusCode: 200, data: JSON.stringify(feedResponse([])) };
    });
    await b2Request(makeTestSession(), '/b2/p/test', 'GET', { foo: 1 });
    // GET では body が送信されない
    expect(gotBody === null || gotBody === '' || gotBody === undefined || String(gotBody).length === 0).toBe(true);
  });

  it('path 先頭スラッシュなしでも動作', async () => {
    getMock().get(BASE_URL).intercept({ path: '/b2/p/test', method: 'GET' }).reply(200, feedResponse([]));
    const res = await b2Request(makeTestSession(), 'b2/p/test', 'GET');
    expect(res).toBeDefined();
  });
});

// ============================================================
// HTTP ステータスコード別の挙動
// ============================================================

describe('HTTPステータスコード別', () => {
  it.each([200])('%d は成功', async (code) => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/x', method: 'GET' })
      .reply(code, feedResponse([]));
    await expect(b2Get(makeTestSession(), '/b2/p/x')).resolves.toBeDefined();
  });

  it.each([400, 404, 409])('%d は B2CloudError', async (code) => {
    getMock().get(BASE_URL).intercept({ path: '/b2/p/x', method: 'GET' }).reply(code, '{}');
    await expect(b2Get(makeTestSession(), '/b2/p/x')).rejects.toThrow(B2CloudError);
  });

  it.each([502, 503, 504])('%d はリトライされ最終的にエラー', async (code) => {
    getMock()
      .get(BASE_URL)
      .intercept({ path: '/b2/p/x', method: 'GET' })
      .reply(code, '')
      .persist();
    await expect(b2Get(makeTestSession(), '/b2/p/x', { maxRetries: 1 })).rejects.toThrow();
  });
});
