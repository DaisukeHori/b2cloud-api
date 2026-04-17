# 追加機能設計書 v2: 配達可否検知 + 最短スロット自動差込

**対象プロジェクト:** `b2cloud-api` (既存リポに機能追加)
**対応バージョン:** v1.6.0(予定、v1.5.1 のJST修正を経由)
**追加ソース:** `https://date.kuronekoyamato.co.jp/date/Takkyubin`
**作成日:** 2026-04-17
**言語:** TypeScript (既存に統合)

**v1 からの主な変更点:**
- 設計思想を「最短日検索」から「**配達可否検知 + 最短日時自動差込**」へ転換
- `auto_shortest.cool` を廃止(既存 `is_cool` を尊重)
- `auto_shortest` 有効時の `is_cool` / `is_printing_date` 上書きを削除
- service_type × is_cool マッピングを明文化(非対応組み合わせはエラー)
- 既存 `normalizeShipmentDate()` の UTC バグを同時修正(全体JST固定)
- HTMLパーサを `htmlparser2` 採用(正規表現依存を排除)
- 環境変数を `B2_DEFAULT_SHIPPER_ZIP` に一本化

---

## 0. このドキュメントの位置付け

既存 `b2cloud-api`(v1.5.0)の機能として、ヤマト運輸の「料金・お届け予定日検索」ページをリバースエンジニアリングした**配達可否検知システム**を統合する。

### 役割の転換(重要)

v1 初稿では「最短日検索」という位置づけだったが、実際には date API は **「この郵便番号・この出荷日において、どの商品(宅急便/宅急便コンパクト/クール/スキー/ゴルフ/空港)が、いつ、どの時間帯で配達可能か」を返す配達可否検知システム**である。

これにより設計がクリーンになる:

1. ユーザーは `shipment.service_type` + `shipment.is_cool` を通常通り指定
2. `auto_shortest: { enabled: true }` だけ追加
3. サーバー側が service_type + is_cool から適切な date API 行(商品カテゴリ)を自動選択
4. その行が配達不可(クール不可等)なら即エラーで発行中止
5. 配達可能なら最短日時を shipment に自動差込して発行

→ **クール切替のような商品選択はユーザーが通常通り行い、auto_shortest はあくまで「日時自動差込」の責務に特化**。

### 共通基盤との分離

- **既存機能(B2クラウド)**: 送り状発行・印刷・追跡番号取得 (`b2cloud.kuronekoyamato.co.jp`)
- **追加機能(date API)**: 配達可否+日時検知 (`date.kuronekoyamato.co.jp`)

2つは別サーバー・別認証体系。共通基盤(`src/b2client.ts`)には混入させず、新ファイル `src/date.ts` として独立させる。

---

## 1. 新機能の概要

### 1-1. 3つの機能を追加

| # | 機能 | REST API | MCP ツール名 |
|---|------|----------|-------------|
| 1 | 配達予定日検索(4商品生データ) | `POST /api/b2/date/search` | `search_delivery_date` |
| 2 | 最短スロット単独取得(調査用) | `POST /api/b2/date/shortest` | `find_shortest_delivery_slot` |
| 3 | 印刷時の最短自動差込(発行用) | `POST /api/b2/print` に `auto_shortest` オプション追加 | `create_and_print_shipment` に `auto_shortest` 引数追加 |

### 1-2. 3層にする理由

- **#1 生データ取得**: 「郵便番号AからBへ4種類の商品で何日で届くか?」という調査用途
- **#2 最短単独取得**: 「発行はしないが、最短日時の組を返してくれ」という準備用途
- **#3 印刷統合**: 「最短で発行」を1コールで完結させる本命機能

#3 が実用上のメインだが、#1 と #2 も単独で価値がある。#2 を MCPツールとして残すのは、ユーザーに「いつ届くか事前に教えて」と聞かれた Claude が発行せずに調べられるようにするため。

---

## 2. 裏API仕様(リバースエンジニアリング結果)

### 2-1. エンドポイント

```
POST https://date.kuronekoyamato.co.jp/date/Takkyubin
Content-Type: application/x-www-form-urlencoded
Referer: https://date.kuronekoyamato.co.jp/date/Takkyubin  (必須)
Origin:  https://date.kuronekoyamato.co.jp                 (推奨)
```

- Cookie: 初回 GET で JSESSIONID を取得 → POST 時に送信(都度新規でも可)
- レスポンス: `text/html; charset=WINDOWS-31J` (Shift_JIS、デコード必須)
- 裏 XHR は存在しない(フォームPOST→HTML返却の同期PostBack、Playwrightで確認済)

### 2-2. リクエストパラメータ

| 名前 | 値 |
|------|-----|
| `ACTID` | 固定値 `J_RKTKJS0010` |
| `PARA_STA` | 発地郵便番号(7桁、ハイフンなし) |
| `PARA_END` | 着地郵便番号(7桁、ハイフンなし) |
| `PARA_YEAR` | 年(YYYY) |
| `PARA_MONTH` | 月(1〜12、ゼロパディング不要) |
| `PARA_DAY` | 日(1〜31、ゼロパディング不要) |
| `PARA_SEARCH_KBN` | v1.6.0 では固定値 `PARA_DELIVERY_SEARCH`(発送日指定)のみサポート。`PARA_CARRY_SEARCH` は v1.7.0 で対応予定 |
| `BTN_EXEC_SLEVEL.x` | 固定値 `10` |
| `BTN_EXEC_SLEVEL.y` | 固定値 `10` |

### 2-3. レスポンスHTMLの構造

```
<h2>宅急便</h2>                           ← メイン宅急便テーブル
  <table class="tableStyle02">
    <tr><th>お届け予定日</th><th>お届け時間帯</th></tr>
    <tr>
      <td>{メイン日付}</td>
      <td>{メイン時間帯制約}</td>
    </tr>
  </table>

<h2>その他の商品</h2>                     ← その他商品テーブル
  <table class="tableStyle01">
    <tr><th>商品名</th><th>お届け予定日</th><th>お届け時間帯</th></tr>
    <tr>
      <td>宅急便コンパクト<br>クール宅急便</td>
      <td>{日付}<span class="fc-red">＊{注記、クール不可の場合}</span></td>
      <td>{時間帯}</td>
    </tr>
    <tr><td>スキー宅急便<br>ゴルフ宅急便</td>...</tr>
    <tr><td>空港宅急便</td>...</tr>
  </table>
```

### 2-4. 時間帯制約の表現(4種、実機確定)

| 日本語表現 | constraint 値 | 指定可能 `delivery_time_zone` |
|---|---|---|
| `午前中から指定可能` | `morning_ok` | `0812`, `1416`, `1618`, `1820`, `1921` |
| `14時から指定可能` | `afternoon_only` | `1416`, `1618`, `1820`, `1921` |
| `18時から指定可能` | `evening_only` | `1820`, `1921` |
| `指定出来ません` | `not_specifiable` | `0000` のみ |
| `－` | `not_applicable` | なし(スキー/空港便のみ) |

### 2-5. クール宅急便の特別扱い

- **通常地域**: 宅急便コンパクト/クール行の日付・時間帯は本体宅急便と同じか近い値
- **クール不可地域**: 日付セルに赤字注記「＊クール宅急便のお取扱いは出来ません。」
  - 対象: 伊豆諸島の**式根島・利島・御蔵島・青ヶ島** + **小笠原村(小笠原諸島)**
  - ページ上部の注記文: `※クール宅急便については、伊豆諸島(うち式根島・利島・御蔵島・青ヶ島)および小笠原村(小笠原諸島)へのお取扱いはいたしません。`

### 2-6. 実機検証サンプル

発地=332-0015(川口市、Revol本社) / 出荷日=2026-04-17(金)

| 地域 | 着ZIP | 宅急便 | 時間帯 | クール |
|---|---|---|---|---|
| 加古川市 | 675-8501 | 4/18 | 午前〜 | ✅ |
| 新宮市 | 647-0011 | 4/18 | 18時〜 | ✅ |
| 田辺市本宮町(本宮) | 647-1731 | 4/18 | 18時〜 | ✅ |
| 田辺市本宮町(渡瀬) | 647-1733 | 4/18 | 18時〜 | ✅ |
| 田辺市(本宮町以外) | 646-8545 | 4/18 | 14時〜 | ✅ |
| 隠岐の島町 | 685-0015 | 4/19 | 14時〜 | ✅ |
| 北大東村 | 901-3901 | 4/27 | 指定不可 | ✅ |
| 久米島町 | 901-3107 | 4/20 | 午前〜 | ✅ |
| 与那国町 | 907-1801 | 4/23 | 指定不可 | ✅ |
| **利島村** | 100-0301 | 4/19 | 指定不可 | ❌ **不可** |
| **小笠原村父島** | 100-2101 | 4/27 | 指定不可 | ❌ **不可** |

---

## 3. 共通方針: JST 基準 & 既存バグ修正

### 3-1. すべての「今日」は JST

ヤマトは日本国内サービスなので、**タイムゾーンは常に `Asia/Tokyo`** に固定する。外国からの利用は想定しない。

#### getTodayJST() の標準実装

```typescript
// src/date-utils.ts (新規)

/**
 * JST(Asia/Tokyo)における今日の日付を 'YYYY-MM-DD' で返す。
 * 実行環境のタイムゾーンに依存しない。
 */
export function getTodayJST(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${d}`;
}

/**
 * JST における今日の日付を B2クラウド形式 'YYYY/MM/DD' で返す。
 */
export function getTodayJstSlash(): string {
  return getTodayJST().replaceAll('-', '/');
}

/**
 * JST の Date オブジェクトから YYYY-MM-DD 文字列を生成。
 * 日付加算などに使う。
 */
export function formatDateJST(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
```

`'en-CA'` ロケールを使うのは `YYYY-MM-DD` 形式で返るため(ISO 8601準拠、Intl の慣用)。

### 3-2. 既存 normalizeShipmentDate() の UTC バグを同時修正

#### 現状の問題(既存バグ)

`src/validation.ts:59-73`:

```typescript
export function normalizeShipmentDate(input: string | Date | undefined): string {
  if (!input) {
    const d = new Date();  // ← 実行環境のTZに依存。Vercel は UTC
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  }
  if (input instanceof Date) {
    return `${input.getFullYear()}/${String(input.getMonth() + 1).padStart(2, '0')}/${String(input.getDate()).padStart(2, '0')}`;
  }
  // ...
}
```

- **バグ**: Vercel Node Runtime はデフォルト `TZ=UTC`。JST 0時〜9時に実行されると、UTC ではまだ前日。`getFullYear()` etc. は実行環境のTZで動作するため、前日の日付が返る。

- **症状**: JST 月曜 03:00 に集荷締切に間に合わせるため送り状を作ると、`shipment_date` が日曜(前日)で発行される → 配達ルート計算がずれる

#### 修正版

```typescript
// src/validation.ts 修正後
import { getTodayJstSlash, formatDateJST } from './date-utils';

export function normalizeShipmentDate(input: string | Date | undefined): string {
  if (!input) {
    return getTodayJstSlash();  // JST基準の今日
  }
  if (input instanceof Date) {
    return formatDateJST(input).replaceAll('-', '/');
  }
  if (/^\d{8}$/.test(input)) {
    return `${input.slice(0, 4)}/${input.slice(4, 6)}/${input.slice(6, 8)}`;
  }
  return input;
}
```

### 3-3. 影響範囲

- `src/validation.ts` のテスト更新必要(既存 `normalizeShipmentDate` のテストで、環境依存な部分を JST 固定に)
- `src/createAndPrint.ts` や `src/print.ts` に `new Date()` 直呼びがあれば監査(要確認)
- タイムゾーン検証用のE2Eテストを追加: `TZ=UTC` と `TZ=Asia/Tokyo` の両方で同じ結果が出ることを確認

### 3-4. `Asia/Tokyo` が使えない環境への対応

Node 20+ の standard build は `Asia/Tokyo` を含むフルICU対応。Vercel の Node 22 ランタイムも full-icu。実機で `Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Tokyo'})` が例外を投げないことを起動時に検証し、失敗したら即クラッシュさせる `assertIcuAvailable()` を `src/server.ts` に追加:

```typescript
function assertIcuAvailable() {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
  } catch (e) {
    throw new Error(
      `ICU full-icu が利用できません。Node を --with-intl=full-icu でビルドするか、` +
      `Vercel の Node Runtime を使ってください。original: ${e}`
    );
  }
}
```

---

## 4. 実装

### 4-1. ファイル構成

```
src/
  date.ts                 # 新規: date API クライアント + HTMLパーサ
  date-utils.ts           # 新規: JST 基準の日付ユーティリティ
  date-shortest.ts        # 新規: 最短スロット選定ロジック(find_shortest_delivery_slot 用)
  auto-shortest.ts        # 新規: print フロー統合用の差込ロジック
  routes/
    date.ts               # 新規: /date/search, /date/shortest 専用ルーター(B2セッション不要)
    b2.ts                 # 変更: /print に auto_shortest 分岐追加
  mcp-tools.ts            # 変更: MCPツール2個追加、create_and_print_shipment に auto_shortest 引数追加
  validation.ts           # 変更: normalizeShipmentDate を JST に修正、auto_shortest / date 系スキーマ追加、
                          #        superRefine で組み合わせバリデーション
  types.ts                # 変更: TimeZoneConstraint 等の型を追加
  app.ts                  # 変更: date ルーティングを B2セッション不要で先に登録

tests/
  date.test.ts                    # 新規: パーサ単体テスト(オフライン、HTMLフィクスチャ使用)
  date-shortest.test.ts           # 新規: 最短選定ロジックテスト
  date-utils.test.ts              # 新規: JST ユーティリティテスト
  auto-shortest.test.ts           # 新規: print 統合ロジックテスト(mock利用)
  fixtures/date/                  # 新規: 11地域 + 追加ケースのHTML
    6758501.html
    6470011.html
    ... (計11ファイル + エッジケース)
  e2e/
    date.e2e.test.ts              # 新規: 実サーバー叩くE2E(E2E_DATE=1 のときのみ)

docs/
  b2cloud-design.md               # 変更: 12章を追加(date API章)
  date-feature-design.v1.md       # 旧設計書(保存)
  date-feature-design.md          # 本設計書(v2)
```

### 4-2. `src/date.ts` のインタフェース

```typescript
import { fetch } from 'undici';
import { parseDocument } from 'htmlparser2';  // 軽量HTMLパーサ
import * as cssSelect from 'css-select';
import DomUtils from 'domutils';

/** 時間帯制約の正規化済み値 */
export type TimeZoneConstraint =
  | 'morning_ok'       // 午前中から指定可能(0812〜全OK)
  | 'afternoon_only'   // 14時から(1416〜OK、0812不可)
  | 'evening_only'     // 18時から(1820〜OK)
  | 'not_specifiable'  // 指定出来ません
  | 'not_applicable';  // スキー/空港便の「－」

/** 時間帯制約 → 有効な delivery_time_zone 配列 */
export const TIME_ZONE_CODES_BY_CONSTRAINT: Record<TimeZoneConstraint, string[]> = {
  morning_ok:      ['0812', '1416', '1618', '1820', '1921'],
  afternoon_only:  ['1416', '1618', '1820', '1921'],
  evening_only:    ['1820', '1921'],
  not_specifiable: ['0000'],
  not_applicable:  [],
};

/** 時間帯制約 → 「真の最短」時間帯コード */
export const EARLIEST_TIME_ZONE_BY_CONSTRAINT: Record<TimeZoneConstraint, string | null> = {
  morning_ok:      '0812',
  afternoon_only:  '1416',
  evening_only:    '1820',
  not_specifiable: '0000',
  not_applicable:  null,
};

/** 入力: 配達予定日検索 */
export interface DateSearchInput {
  /** ハイフン有無どちらでも可、内部で正規化 */
  shipperZipCode: string;
  consigneeZipCode: string;
  /** 'shipment' = 発送日指定(v1.6.0 では shipment のみサポート) */
  searchKbn?: 'shipment';
  /** YYYY-MM-DD or YYYY/MM/DD、省略時は JST の今日 */
  date?: string;
}

/** 1商品あたりの配達情報 */
export interface ProductDeliveryInfo {
  /** ISO日付 "YYYY-MM-DD" */
  deliveryDate: string;
  /** 生の日本語表記、例: "2026年04月18日" */
  deliveryDateJp: string;
  /** 時間帯制約(正規化) */
  constraint: TimeZoneConstraint;
  /** 生の時間帯表記 */
  constraintJp: string;
  /** 赤字注記(例: "クール宅急便のお取扱いは出来ません。") */
  notice?: string;
}

/** 出力: 配達予定日検索(4商品分) */
export interface DateSearchResult {
  shipperZipCode: string;
  consigneeZipCode: string;
  /** 出荷日(検索時の基準日) */
  shipmentDate: string;  // "YYYY-MM-DD"

  /** 宅急便(メイン、service_type 0/2/5/6 + is_cool=0) */
  takkyubin: ProductDeliveryInfo;

  /** 宅急便コンパクト / クール宅急便 (service_type 8/9、または 0/2/5/6 + is_cool=1,2) */
  compactCool: ProductDeliveryInfo & {
    coolAvailable: boolean;  // このエリアでクール取扱可能か
  };

  /** スキー宅急便 / ゴルフ宅急便 (情報提供のみ、B2クラウドの発行では使わない) */
  skiGolf: ProductDeliveryInfo;

  /** 空港宅急便 (情報提供のみ) */
  airport: ProductDeliveryInfo;

  /** ページ全体の注意事項 */
  globalNotices: string[];

  /** 生HTML(開発モード限定、本番では undefined を強制) */
  rawHtml?: string;
}

/** メイン関数 */
export async function searchDeliveryDate(
  input: DateSearchInput,
  options?: {
    /** 本番モードでは無視される */
    includeRawHtml?: boolean;
    userAgent?: string;
    timeoutMs?: number;
  }
): Promise<DateSearchResult>;

/** パーサ単体(テスト用に export) */
export function parseDateSearchHtml(html: string): Omit<DateSearchResult,
  'shipperZipCode' | 'consigneeZipCode' | 'shipmentDate'>;
```

### 4-3. HTMLパーサの実装方針

#### htmlparser2 採用

v1 では「正規表現で十分」と書いたが、以下の理由で **`htmlparser2` + `domutils` + `css-select`** を採用する:

- HTMLエスケープ (`&nbsp;`, `&#xxxx;`) の自動デコード
- 属性クォートのバリエーションに強い
- `<br>` `<br/>` `<br />` の正規化
- コメント `<!-- -->` の自動除外
- バンドルサイズは合計 ~40KB(cheerio の 1/10、実用上問題なし)
- Node 標準で使えて Vercel でも動く

#### パーサの責務分割

```typescript
function parseDateSearchHtml(html: string) {
  const doc = parseDocument(html);

  // 1. 宅急便メインテーブル
  const takkyubinTable = cssSelect.selectOne(
    'h2:contains("宅急便") + table.tableStyle02', doc
  );
  const takkyubin = extractMainRow(takkyubinTable);

  // 2. その他の商品テーブル
  const otherTable = cssSelect.selectOne(
    'h2:contains("その他の商品") + table.tableStyle01', doc
  );
  const [compactCoolRow, skiGolfRow, airportRow] = extractOtherRows(otherTable);

  return {
    takkyubin,
    compactCool: {
      ...compactCoolRow,
      coolAvailable: !compactCoolRow.notice?.includes('お取扱いは出来ません'),
    },
    skiGolf: skiGolfRow,
    airport: airportRow,
    globalNotices: extractGlobalNotices(doc),
  };
}
```

#### 未知表現の扱い

```typescript
function normalizeTimeZone(jp: string): TimeZoneConstraint {
  if (jp.includes('午前中から')) return 'morning_ok';
  if (jp.includes('14時から')) return 'afternoon_only';
  if (jp.includes('18時から')) return 'evening_only';
  if (jp.includes('指定出来ません')) return 'not_specifiable';
  if (jp === '－' || jp === '-' || jp === '') return 'not_applicable';
  throw new ParseError(`未知の時間帯表現: "${jp}"`, 'UNKNOWN_TIME_ZONE_PHRASE');
}
```

**未知表現は `500 PARSE_ERROR` としてエラー化**。ヤマトがページ文言を変えたら早期検知するため、黙って握り潰さない。

### 4-4. Shift_JIS デコード

```typescript
async function fetchAndDecode(url: string, body: string): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=WINDOWS-31J',
      'Referer': 'https://date.kuronekoyamato.co.jp/date/Takkyubin',
      'Origin': 'https://date.kuronekoyamato.co.jp',
      'User-Agent': DEFAULT_UA,
    },
    body,
    signal: AbortSignal.timeout(DATE_API_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new UpstreamError(res.status, res.statusText);
  }
  const buf = await res.arrayBuffer();
  return new TextDecoder('shift-jis').decode(buf);
}
```

`TextDecoder('shift-jis')` は Node 20+ の full-icu ビルドで標準対応。起動時に `assertIcuAvailable()` で確認する(3-4 参照)。

### 4-5. Cookie 管理

都度新規取得する(サーバーレス前提):

```typescript
async function getSession(): Promise<DateSession> {
  const res = await fetch('https://date.kuronekoyamato.co.jp/date/Takkyubin', {
    method: 'GET',
    headers: { 'User-Agent': DEFAULT_UA },
    signal: AbortSignal.timeout(DATE_API_TIMEOUT_MS),
  });
  const setCookies = res.headers.getSetCookie();
  const jsessionId = setCookies.find((c) => c.startsWith('JSESSIONID='))?.split(';')[0].split('=')[1];
  const secureBigIp = setCookies.find((c) => c.startsWith('SECURE_BIGip_'))?.split(';')[0];
  return { jsessionId, secureBigIp };
}
```

### 4-6. includeRawHtml の本番ガード

`includeRawHtml: true` で呼ばれても、`NODE_ENV === 'production'` では無視:

```typescript
if (options?.includeRawHtml && process.env.NODE_ENV !== 'production') {
  result.rawHtml = html;
}
```

---

## 5. `src/date-shortest.ts` のロジック

### 5-1. インタフェース

```typescript
import { DateSearchResult, TimeZoneConstraint, EARLIEST_TIME_ZONE_BY_CONSTRAINT } from './date';

/** service_type を date API のどの行にマップするか */
export type DateApiRow = 'takkyubin' | 'compactCool';

/** 対応済みサービスタイプ(auto_shortest 対応) */
export type SupportedServiceType = '0' | '2' | '5' | '6' | '8' | '9';

export interface FindShortestInput {
  shipperZipCode: string;
  consigneeZipCode: string;
  /** 'shipment' のみサポート(v1.6.0) */
  searchKbn?: 'shipment';
  /** B2クラウドの service_type。"0","2","5","6","8","9" のみ対応。省略時は "0" */
  serviceType?: SupportedServiceType;
  /** "0","1","2"。省略時は "0" */
  isCool?: '0' | '1' | '2';
  /** 省略時は JST の今日 */
  shipmentDate?: string;
}

export interface FindShortestOutput {
  /** B2クラウド create_and_print_shipment にそのまま渡せる値 */
  shipmentDate: string;     // "YYYY/MM/DD"
  deliveryDate: string;     // "YYYY/MM/DD"
  deliveryTimeZone: string; // "0812" | "1416" | "1618" | "1820" | "1921" | "0000"

  /** 採用した date API 行 */
  usedRow: DateApiRow;

  /** 時間帯制約(元の情報) */
  constraint: TimeZoneConstraint;
  constraintJp: string;

  /** クール取扱可否(is_cool != '0' のとき意味を持つ) */
  coolAvailable: boolean;

  /** 判断根拠 */
  rationale: string;

  /** 到着時刻の推定(時間帯の開始時刻、ISO 8601 JST) */
  estimatedArrival: string;

  /** 代替時間帯(任意、UI表示用) */
  alternatives: Array<{
    deliveryTimeZone: string;
    label: string;
  }>;

  /** 警告(エラーではない) */
  warnings: string[];

  /** 元データ */
  raw: DateSearchResult;
}

export async function findShortestDeliverySlot(
  input: FindShortestInput
): Promise<FindShortestOutput>;
```

### 5-2. service_type × is_cool → date API 行のマッピング

```typescript
function selectRow(serviceType: SupportedServiceType, isCool: '0' | '1' | '2'): DateApiRow {
  // 宅急便コンパクト系は常に compactCool 行
  if (serviceType === '8' || serviceType === '9') return 'compactCool';

  // 通常宅急便で is_cool != '0' は compactCool 行(クール情報を見る)
  if (isCool !== '0') return 'compactCool';

  // それ以外は takkyubin 行
  return 'takkyubin';
}
```

### 5-3. アルゴリズム

```
1. Zod バリデーション(非対応 service_type はここでエラー)
2. searchDeliveryDate() を呼ぶ
3. selectRow(serviceType, isCool) で行を選ぶ
4. 選んだ行が compactCool で isCool != '0' の場合、coolAvailable = false なら
   → COOL_UNAVAILABLE エラー(HTTP 400)
5. constraint から EARLIEST_TIME_ZONE_BY_CONSTRAINT で最短時間帯を採用
6. rationale を生成(発地ZIP → 着地ZIP、出荷日、着日、最短時間帯)
7. estimatedArrival 算出(JST の着日 + 時間帯の開始時刻)
8. alternatives を TIME_ZONE_CODES_BY_CONSTRAINT[constraint] の後続から最大3件
```

### 5-4. rationale の生成(県名取得)

v1 では「(埼玉県)」等の県名を使っていたが、date API の HTML から県名を取るのは不安定(将来変更リスク)。**県名は rationale から除外**し、郵便番号のみで表現する:

```
"発地 332-0015 → 着地 338-0012、出荷 2026/04/17、着日 2026/04/18(翌日)、時間帯 午前中(08-12時)"
```

県名が欲しい場合は、将来的に郵便番号→県名の静的マップ(`src/prefectures.ts`)を追加する形で拡張余地を残す(v1.6.0 ではスコープ外)。

---

## 6. REST API ルート

### 6-1. 認証構造

既存 `app.ts` の `/api/b2` は「API Key + B2セッション」が必須だが、date API は B2セッション不要。ルーティングを以下のように整理:

```typescript
// src/app.ts 変更前(抜粋)
app.use('/api/b2', apiKeyMiddleware, sessionMiddleware, b2Router);

// 変更後
// date ルートを先に登録(API Keyのみ、B2セッション不要)
app.use('/api/b2/date', apiKeyMiddleware, dateRouter);
// それ以外の B2 ルート(API Key + B2セッション必須)
app.use('/api/b2', apiKeyMiddleware, sessionMiddleware, b2Router);
```

**注意**: Express のルーティングは**登録順で評価される**ので、より具体的な `/api/b2/date` を先に登録する必要がある。

### 6-2. `src/routes/date.ts`(新規)

```typescript
import { Router } from 'express';
import { dateSearchSchema, dateShortestSchema } from '../validation';
import { searchDeliveryDate } from '../date';
import { findShortestDeliverySlot } from '../date-shortest';

const router = Router();

/**
 * @openapi
 * /api/b2/date/search:
 *   post:
 *     summary: ヤマト運輸 配達予定日検索(料金ページ裏API)
 *     tags: [Date]
 *     security: [{ ApiKeyQuery: [] }, { ApiKeyHeader: [] }]
 *     description: |
 *       date.kuronekoyamato.co.jp をスクレイピングし、発地/着地/出荷日から
 *       4商品別(宅急便/コンパクト・クール/スキー・ゴルフ/空港)の配達予定日と
 *       時間帯制約を構造化JSONで返す。B2クラウド認証は不要。
 *       クール不可地域(式根島・利島・御蔵島・青ヶ島、小笠原村)では
 *       compactCool.coolAvailable=false を返す。
 */
router.post('/search', async (req, res, next) => {
  try {
    const input = dateSearchSchema.parse(req.body);
    const result = await searchDeliveryDate(input);
    res.json(result);
  } catch (e) { next(e); }
});

/**
 * @openapi
 * /api/b2/date/shortest:
 *   post:
 *     summary: 最短配達スロット取得
 *     tags: [Date]
 *     security: [{ ApiKeyQuery: [] }, { ApiKeyHeader: [] }]
 *     description: |
 *       B2クラウド発行で使える形式(shipment_date, delivery_date, delivery_time_zone)で
 *       最短スロットを返す。service_type="4"(タイムサービス), "3"(DM便), "7"(ゆうパケット),
 *       "A"(ネコポス)は非対応(UNSUPPORTED_SERVICE_TYPE_FOR_AUTO_SHORTEST エラー)。
 */
router.post('/shortest', async (req, res, next) => {
  try {
    const input = dateShortestSchema.parse(req.body);
    const result = await findShortestDeliverySlot(input);
    res.json(result);
  } catch (e) { next(e); }
});

export default router;
```

### 6-3. `/api/b2/print` に auto_shortest 分岐追加

既存の `router.post('/print', ...)` のループ内で、`auto_shortest.enabled` が立っていたら `auto-shortest.ts` のミドル層を通してから `createAndPrint` or `printWithFormat` を呼ぶ。詳細は 7章。

---

## 7. auto_shortest 統合(本命)

### 7-1. `src/auto-shortest.ts` 新規

```typescript
import type { Shipment } from './types';
import { searchDeliveryDate } from './date';
import { findShortestDeliverySlot, selectRow } from './date-shortest';
import type { ShipmentInput } from './validation';

/** auto_shortest_applied 診断情報 */
export interface AutoShortestApplied {
  shipment_date: string;
  delivery_date: string;
  delivery_time_zone: string;
  constraint: string;
  constraint_jp: string;
  used_row: 'takkyubin' | 'compactCool';
  cool_requested: boolean;  // is_cool が '1' or '2' だったか
  cool_available: boolean;
  estimated_arrival: string;
  rationale: string;
}

/**
 * auto_shortest が有効な shipment に対して、delivery_date と delivery_time_zone を
 * 自動差込する。既存の is_cool / service_type は尊重する。
 *
 * 必須: input.shipment_date が指定されていること (呼び出し側で superRefine 済み前提)
 */
export async function applyAutoShortest(
  input: ShipmentInput,
  shipperZipCode: string,
  shipment: Shipment
): Promise<{ shipment: Shipment; applied: AutoShortestApplied }> {
  const strategy = input.auto_shortest?.time_zone_strategy ?? 'earliest';

  const result = await findShortestDeliverySlot({
    shipperZipCode,
    consigneeZipCode: input.consignee_zip_code,
    serviceType: input.service_type as any,  // Zod で非対応 type は既に除外済み
    isCool: input.is_cool,
    shipmentDate: input.shipment_date,
  });

  // delivery_time_zone は strategy に応じて決める
  const deliveryTimeZone = strategy === 'unspecified' ? '0000' : result.deliveryTimeZone;

  return {
    shipment: {
      ...shipment,
      delivery_date: result.deliveryDate,
      delivery_time_zone: deliveryTimeZone,
      // ★ is_cool は絶対に上書きしない
      // ★ is_printing_date も上書きしない
    },
    applied: {
      shipment_date: result.shipmentDate,
      delivery_date: result.deliveryDate,
      delivery_time_zone: deliveryTimeZone,
      constraint: result.constraint,
      constraint_jp: result.constraintJp,
      used_row: result.usedRow,
      cool_requested: input.is_cool !== '0',
      cool_available: result.coolAvailable,
      estimated_arrival: result.estimatedArrival,
      rationale: result.rationale,
    },
  };
}

/**
 * バッチ版: shipments 配列に対して並列実行。
 * キャッシュキーは 3タプル (shipperZip, consigneeZip, shipmentDate)
 * ※ serviceType と isCool は同じ date API 結果から行選択するだけなので、
 *   キャッシュキーには不要。
 */
export async function applyAutoShortestBatch(
  inputs: Array<{ input: ShipmentInput; shipment: Shipment }>,
  shipperZipCode: string
): Promise<Array<{ shipment: Shipment; applied: AutoShortestApplied }>> {
  // 実装詳細は 7-4 参照
}
```

### 7-2. superRefine による条件付きバリデーション

`src/validation.ts` に追加:

```typescript
/** auto_shortest オプション */
const autoShortestSchema = z
  .object({
    enabled: z.literal(true),
    time_zone_strategy: z.enum(['earliest', 'unspecified']).optional(),
  })
  .optional();

// 既存 shipmentInputSchema にフィールド追加
export const shipmentInputSchema = z
  .object({
    // 既存フィールド...
    service_type: z.enum(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A']),
    is_cool: z.enum(['0', '1', '2']).default('0'),
    shipment_date: z.string().optional(),
    // ...
    auto_shortest: autoShortestSchema,  // 新規
  })
  .superRefine((val, ctx) => {
    // 1. auto_shortest.enabled=true のとき shipment_date は必須
    if (val.auto_shortest?.enabled && !val.shipment_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shipment_date'],
        params: { errorCode: 'SHIPMENT_DATE_REQUIRED' },
        message: 'auto_shortest.enabled=true のとき shipment_date は必須です',
      });
    }

    // 2. auto_shortest 非対応 service_type チェック
    if (val.auto_shortest?.enabled) {
      const unsupported: Record<string, string> = {
        '1': 'unused', // 理論値、通常未使用
        '3': 'DM便',
        '4': 'タイムサービス(別料金・別仕様、別途 delivery_time_zone="0010" or "0017" を手動指定してください)',
        '7': 'クロネコゆうパケット',
        'A': 'ネコポス',
      };
      if (unsupported[val.service_type]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['auto_shortest'],
          params: { errorCode: 'UNSUPPORTED_SERVICE_TYPE_FOR_AUTO_SHORTEST' },
          message: `service_type="${val.service_type}" (${unsupported[val.service_type]}) は auto_shortest 非対応です。delivery_date と delivery_time_zone を手動指定してください。`,
        });
      }
    }

    // 3. service_type × is_cool の不正組み合わせチェック(auto_shortest 有無問わず)
    const coolForbidden = new Set(['3', '4', '7', 'A']);  // これらは冷凍/冷蔵不可
    if (coolForbidden.has(val.service_type) && val.is_cool !== '0') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['is_cool'],
        params: { errorCode: 'INVALID_SERVICE_COOL_COMBINATION' },
        message: `service_type="${val.service_type}" ではクール発送(is_cool="${val.is_cool}")を指定できません`,
      });
    }
  });
```

### 7-3. `/api/b2/print` ルートの変更

```typescript
router.post('/print', async (req, res, next) => {
  try {
    const input = printBodySchema.parse(req.body);
    const session = req.b2session!;
    const defaults = getDefaultShipperFromEnv();
    const shipperZipCode = defaults.shipper_zip_code ?? process.env.B2_DEFAULT_SHIPPER_ZIP;
    if (!shipperZipCode) throw new Error('B2_DEFAULT_SHIPPER_ZIP 未設定');
    const printType = input.print_type ?? (process.env.B2_DEFAULT_PRINT_TYPE as any) ?? 'm5';

    // auto_shortest を有効化する shipment がある場合、バッチ処理で date API を呼ぶ
    const needShortest = input.shipments
      .map((s, idx) => ({ s, idx }))
      .filter(({ s }) => s.auto_shortest?.enabled);

    const shortestMap = new Map<number, AutoShortestApplied>();
    if (needShortest.length > 0) {
      const results = await applyAutoShortestBatch(
        needShortest.map(({ s }) => ({ input: s, shipment: inputToShipment(s, defaults) })),
        shipperZipCode
      );
      needShortest.forEach(({ idx }, i) => {
        shortestMap.set(idx, results[i].applied);
      });
    }

    const results = [];
    for (const [idx, s] of input.shipments.entries()) {
      let shipment = inputToShipment(s, defaults);
      let applied: AutoShortestApplied | undefined;

      if (s.auto_shortest?.enabled) {
        applied = shortestMap.get(idx);
        shipment = {
          ...shipment,
          delivery_date: applied!.delivery_date,
          delivery_time_zone: applied!.delivery_time_zone,
        };
      }

      const r = input.output_format
        ? await printWithFormat(session, shipment, input.output_format)
        : await createAndPrint(session, shipment, printType);

      results.push({
        tracking_number: r.trackingNumber,
        internal_tracking: r.internalTracking,
        issue_no: r.issueNo,
        search_key4: r.searchKey4,
        pdf_size: r.pdfSize,
        pdf_download_path: generateSignedDownloadPath(r.trackingNumber),
        pdf_base64: toBase64(r.pdf),
        ...(applied ? { auto_shortest_applied: applied } : {}),
      });
    }

    res.json({ results });
  } catch (e: any) {
    next(e);
  }
});
```

### 7-4. バッチキャッシュ(3タプルキー)

```typescript
// src/auto-shortest.ts

export async function applyAutoShortestBatch(
  inputs: Array<{ input: ShipmentInput; shipment: Shipment }>,
  shipperZipCode: string
): Promise<Array<{ shipment: Shipment; applied: AutoShortestApplied }>> {
  // キャッシュキー: shipperZip + consigneeZip + shipmentDate (JST)
  // isCool / serviceType は行選択で分岐するが、date API の結果自体は同じなので
  // キャッシュキーには不要
  const cache = new Map<string, Promise<DateSearchResult>>();

  const promises = inputs.map(async ({ input, shipment }) => {
    const consigneeZip = normalizeZip(input.consignee_zip_code);
    const shipmentDate = input.shipment_date!;  // superRefine で必須化済み
    const cacheKey = `${shipperZipCode}::${consigneeZip}::${shipmentDate}`;

    if (!cache.has(cacheKey)) {
      cache.set(cacheKey, searchDeliveryDate({
        shipperZipCode,
        consigneeZipCode: consigneeZip,
        date: shipmentDate,
        searchKbn: 'shipment',
      }));
    }

    const rawResult = await cache.get(cacheKey)!;
    // 行選択と結果整形
    return buildShortestFromResult(rawResult, input, shipment);
  });

  return Promise.all(promises);
}
```

**利点**: 1000件の shipments で送り先が100種類に集約されるなら、date API 呼び出しは100回(キャッシュヒット900回)で済む。

---

## 8. MCP ツール統合

### 8-1. `create_and_print_shipment` に `auto_shortest` 引数追加

```typescript
server.registerTool('create_and_print_shipment', {
  description: `
(既存のディスクリプション)
...

★★★「最短で」「急ぎで」「早く届けて」と指示されたとき:★★★
auto_shortest: { "enabled": true } を引数に追加するだけでOK。
delivery_date と delivery_time_zone は指定不要(自動算出される)。

必須: shipment_date("YYYY/MM/DD"形式)
  - 「今日出す」のか「来週月曜出す」のかを明示する義務がある
  - 省略すると SHIPMENT_DATE_REQUIRED エラー

必須でない: is_cool は通常通り扱う
  - is_cool="2"(冷蔵) で send → date API のクール行を参照
  - クール不可地域(伊豆諸島/小笠原)なら COOL_UNAVAILABLE エラー
  - エラーが返ったら「このエリアはヤマトのクール宅急便取扱対象外です。
    他社便(佐川急便のクール便等)をご検討ください」とユーザーに案内

★ auto_shortest 非対応の service_type:
  - "3" DM便、"4" タイムサービス、"7" ゆうパケット、"A" ネコポス
  - これらは date API 対象外、または別仕様
  - auto_shortest=true 指定で UNSUPPORTED_SERVICE_TYPE_FOR_AUTO_SHORTEST エラー
  - タイムサービスの場合は delivery_time_zone="0010"(翌朝10時) or "0017"(17時) を手動指定

⚠️ Claude が絶対にやってはいけないこと:
  - delivery_date を自分で推測する(関東→関西の日数など)
  - delivery_time_zone を "0000" のまま「最短」と称する
  - auto_shortest で shipment_date を省略する
`,
  inputSchema: {
    // 既存の引数 + 新規:
    auto_shortest: z.object({
      enabled: z.literal(true),
      time_zone_strategy: z.enum(['earliest', 'unspecified']).optional(),
    }).optional(),
  },
});
```

### 8-2. `search_delivery_date`(新規 MCPツール)

```typescript
server.registerTool('search_delivery_date', {
  description: `
ヤマト運輸の「料金・お届け予定日検索」ページを裏で呼び出し、発地/着地/出荷日から
配達予定日と時間帯制約を取得する(B2クラウド認証は不要)。

4つの商品カテゴリ別に結果を返す:
  - takkyubin: 宅急便(メイン、service_type=0,2,5,6 + is_cool=0)
  - compactCool: 宅急便コンパクト / クール宅急便(service_type=8,9 または is_cool!=0)
  - skiGolf: スキー / ゴルフ (情報提供のみ、発行には使わない)
  - airport: 空港宅急便 (情報提供のみ)

時間帯制約(constraint):
  "morning_ok"     → 午前中から指定可能(0812〜全OK)
  "afternoon_only" → 14時から(1416〜OK)
  "evening_only"   → 18時から(1820〜OK)
  "not_specifiable"→ 時間帯指定不可(0000のみ)
  "not_applicable" → スキー/空港便は時間帯指定対象外

クール不可地域(伊豆諸島の式根島/利島/御蔵島/青ヶ島、小笠原村)では
compactCool.coolAvailable=false を返す。

★ 発行はしない。発行するなら create_and_print_shipment を auto_shortest: true で使う。
`,
  inputSchema: {
    shipper_zip_code: z.string(),
    consignee_zip_code: z.string(),
    date: z.string().optional(),  // YYYY-MM-DD or YYYY/MM/DD、省略時はJST今日
  },
});
```

### 8-3. `find_shortest_delivery_slot`(新規 MCPツール、調査用途)

```typescript
server.registerTool('find_shortest_delivery_slot', {
  description: `
お届け先郵便番号・service_type・is_cool から、最短で到着できる
(shipment_date, delivery_date, delivery_time_zone) の組を返す。

★ このツールは「調査用」。実発行するなら create_and_print_shipment に
  auto_shortest: { enabled: true } を付けるほうが1コールで済んで楽。

このツールを使うべきケース:
  - ユーザーが「東京から沖縄、最短で何日?」と質問してきたときの回答
  - 発行の前に複数候補を比較したい

非対応 service_type:
  - "3" DM便、"4" タイムサービス、"7" ゆうパケット、"A" ネコポス
  - UNSUPPORTED_SERVICE_TYPE_FOR_AUTO_SHORTEST エラー
`,
  inputSchema: {
    consignee_zip_code: z.string(),
    shipper_zip_code: z.string().optional(),  // 省略時は B2_DEFAULT_SHIPPER_ZIP
    service_type: z.enum(['0', '2', '5', '6', '8', '9']).optional(),  // 省略時 "0"
    is_cool: z.enum(['0', '1', '2']).optional(),  // 省略時 "0"
    shipment_date: z.string().optional(),  // 省略時 JST今日
  },
});
```

---

## 9. 環境変数

既存の `B2_DEFAULT_SHIPPER_ZIP` を流用する(新規変数は追加しない):

```
B2_DEFAULT_SHIPPER_ZIP=3320015   # 既存、find_shortest のデフォルト発地にも流用
DATE_API_TIMEOUT_MS=8000         # 新規、date API の HTTP タイムアウト
NODE_ENV=production              # 既存、includeRawHtml の無効化判定
```

---

## 10. エラー処理

| エラー | HTTPコード | コード | 意味 |
|---|---|---|---|
| 郵便番号が7桁でない | 400 | `INVALID_ZIP` | フォーマット不正 |
| 出荷日が不正 | 400 | `INVALID_DATE` | 日付フォーマット不正、過去日等 |
| auto_shortest=true で shipment_date 未指定 | 400 | `SHIPMENT_DATE_REQUIRED` | superRefine で検出 |
| auto_shortest 非対応 service_type | 400 | `UNSUPPORTED_SERVICE_TYPE_FOR_AUTO_SHORTEST` | 3/4/7/A |
| service_type × is_cool 不正組み合わせ | 400 | `INVALID_SERVICE_COOL_COMBINATION` | DM便×クール等 |
| クール不可地域にクール発送 | 400 | `COOL_UNAVAILABLE` | date API 結果から検出 |
| ヤマトサーバー 5xx | 502 | `UPSTREAM_ERROR` | |
| タイムアウト | 504 | `UPSTREAM_TIMEOUT` | `DATE_API_TIMEOUT_MS` 超過 |
| date API 一時障害(auto_shortest 内) | 502 | `DATE_API_UNAVAILABLE` | **フォールバックは用意しない**、リトライ案内 |
| 未知の時間帯表現 | 500 | `PARSE_ERROR` | ヤマトが文言変更 → 要調査 |
| ICU 未対応 | 500 | `ICU_UNAVAILABLE` | 起動時チェックで fail fast |

**HTTPステータスコードとエラーレスポンス形式は既存 `errorMiddleware` に合わせる**:

```json
{
  "error": "INVALID_SERVICE_COOL_COMBINATION",
  "message": "service_type=\"3\" ではクール発送(is_cool=\"1\")を指定できません",
  "path": ["is_cool"]
}
```

---

## 11. テスト戦略

### 11-1. 単体テスト

- `tests/date-utils.test.ts`: `getTodayJST()` が TZ=UTC 環境でも JST 基準を返す
- `tests/date.test.ts`: 11地域HTMLフィクスチャで `parseDateSearchHtml()` が正しく動く
- `tests/date-shortest.test.ts`: 行選択、constraint→時間帯コード変換、クール不可検知
- `tests/auto-shortest.test.ts`: バッチキャッシュ、shipment 上書き、applied 情報生成
- `tests/validation.test.ts`: superRefine の組み合わせバリデーション

### 11-2. E2E テスト

- `tests/e2e/date.e2e.test.ts`: 実 date API を叩いて 11地域の結果が期待通りか検証
- `tests/e2e/auto-shortest.e2e.test.ts`: 実 B2クラウドで auto_shortest=true で発行し、`auto_shortest_applied` が正しく返る
- **既存の E2E 発行テスト用 shipment の `shipment_date` が UTC バグで前日になっていないか**の回帰テスト

### 11-3. TZ 環境での挙動確認

```bash
TZ=UTC pnpm test
TZ=Asia/Tokyo pnpm test
```

両方で全テストが通ることを CI で保証(GitHub Actions 側のマトリクス化)。

---

## 12. 破壊的変更の有無と移行計画

### 12-1. 破壊的変更: 限定的

- `normalizeShipmentDate()` の挙動変更: UTC から JST へ
  - **影響**: JST 0〜9時に `shipment_date` 省略で発行していた運用がある場合、今までは前日、今後は正しい日付が入る
  - **通常は利用者にとって嬉しい方向の修正**(ただし「前日挙動を頼ってた」レアケースは破綻)
  - 既存クライアントへの通知は CHANGELOG で大きめに記載
- 既存 `shipmentInputSchema` は拡張のみ(新規 optional フィールド追加)、破壊的変更なし

### 12-2. 段階リリース

- **v1.5.1(緊急パッチ)**: `normalizeShipmentDate()` の UTC バグ修正のみ
- **v1.6.0**: 本設計書の全機能追加

v1.5.1 を挟むことで、既存ユーザーにタイムゾーン修正だけを早く届けられる。

---

## 13. 実装順序

### フェーズ 0: バグ修正(v1.5.1)

1. `src/date-utils.ts` 作成(`getTodayJST()`, `getTodayJstSlash()`, `formatDateJST()`)
2. `src/date-utils.test.ts` 作成
3. `src/validation.ts` の `normalizeShipmentDate()` を JST 基準に修正
4. 既存テストの UTC 依存箇所を修正
5. TZ マトリクスの CI 追加
6. v1.5.1 リリース

### フェーズ 1: date API 基盤(v1.6.0 先行)

7. `src/date.ts` の `searchDeliveryDate()` + HTML パーサ実装(htmlparser2)
8. `tests/fixtures/date/` に11地域HTML配置 + `tests/date.test.ts`
9. `assertIcuAvailable()` を `src/server.ts` に追加
10. `src/date-shortest.ts` の `findShortestDeliverySlot()` 実装 + テスト

### フェーズ 2: スキーマとルート

11. `src/validation.ts` に `autoShortestSchema`, `dateSearchSchema`, `dateShortestSchema` 追加
12. `src/validation.ts` に `superRefine` で組み合わせバリデーション追加
13. `src/routes/date.ts` 新規(`/date/search`, `/date/shortest`)
14. `src/app.ts` のルーティング構造変更(date 用に B2セッション不要ルート分離)
15. Swagger 注釈追加

### フェーズ 3: print 統合

16. `src/auto-shortest.ts` 実装(`applyAutoShortest`, `applyAutoShortestBatch`)
17. `tests/auto-shortest.test.ts`(mock で date API 差し替え)
18. `src/routes/b2.ts` の `/print` に auto_shortest 分岐追加

### フェーズ 4: MCP

19. `src/mcp-tools.ts` に `search_delivery_date`, `find_shortest_delivery_slot` 追加
20. `create_and_print_shipment` のディスクリプション刷新 + `auto_shortest` 引数追加
21. `tests/mcp-tools.test.ts` 拡張

### フェーズ 5: 仕上げ

22. `docs/b2cloud-design.md` に 12章追加
23. `README.md` に使用例
24. `CHANGELOG.md` に v1.5.1 と v1.6.0 の変更点
25. E2E テスト(TZ=UTC/Asia/Tokyo 両方で、実 date API + 実 B2クラウド)
26. v1.6.0 リリース

---

## 14. 工数見積もり

| フェーズ | 作業 | 見積 |
|---|---|---|
| **フェーズ0**(v1.5.1) | JST 化 + TZ回帰テスト | **2h** |
| **フェーズ1** | date.ts + パーサ + テスト | **6h** |
| | date-shortest.ts + テスト | **2.5h** |
| **フェーズ2** | validation.ts + superRefine | **1.5h** |
| | routes/date.ts + ルーティング変更 | **1.5h** |
| | Swagger 注釈 | **1h** |
| **フェーズ3** | auto-shortest.ts + バッチキャッシュ | **3h** |
| | /print の分岐統合 + テスト | **1.5h** |
| **フェーズ4** | MCP 2新ツール | **1.5h** |
| | create_and_print_shipment 刷新 | **1h** |
| | mcp-tools.test.ts 拡張 | **1h** |
| **フェーズ5** | ドキュメント | **1.5h** |
| | E2E 実機確認・TZ マトリクス | **3h** |
| | リリース作業 | **0.5h** |
| **小計** | | **27h** |
| **リスクバッファ 25%** | | **+7h** |
| **合計** | | **34h(4〜4.5人日相当)** |

### 集中度別の現実的試算(堀さん自身が Claude Code で進める場合)

- **集中ぶっ通し**: 2〜3日(実働16〜24h)
- **通常並行**: 1週間〜10日
- **リスク顕在化**: 最大2週間

### 主なリスク源泉

1. **ヤマト bot 検知**: 大量検証で IP ブロック → リカバリ 1〜2h
2. **祝日・年末年始の文言パターン発覚**: v1.6.0 リリース後の緊急パッチ 半日〜1日
3. **htmlparser2 + css-select で jQuery 系古いHTMLを扱う際の想定外**: +2h
4. **`TextDecoder('shift-jis')` が Vercel で動かない**: iconv-lite 必須化 +2h
5. **Express ルーティング順序問題(`/api/b2/date` vs `/api/b2`)でデバッグ**: +1h
6. **既存 `shipmentInputSchema` の他の箇所に `new Date()` 依存が潜んでいる**: 監査 +2h

---

## 15. 決定事項(レビューでクローズ済)

v2 レビュー(2026-04-17)で以下の項目は全て決定済み:

1. **タイムサービス(service_type=4)対応** → **v1.6.0 で非対応**(auto_shortest 不使用時は従来通り発行可能)
   - 理由: `date.kuronekoyamato.co.jp/date/Main?LINK=TS` は `www.kuronekoyamato.co.jp/ytc/search/payment/simulation.html?service=TS` にリダイレクトされ、**郵便番号精度での対応可否を返す公開 API が存在しない**
   - ヤマト公式も「取扱、配達エリアに指定がございますので、事前にお近くの営業所もしくはサービスセンターへお問い合わせください」と明記
   - v1.7.0 以降で、何らかの公式 API 公開を待って再検討
2. **`PARA_CARRY_SEARCH`(お届け日指定モード)対応** → **スコープ外**として廃棄
   - 理由: これは「希望到着日 → 発送すべき日」の逆算機能で、auto_shortest(出荷日 → 到着日)とは方向が違うため今回の機能対象外
3. **rationale の県名表示** → **v1.6.0 では ZIP のみ**、県名マップは後続の拡張として余地を残す
4. **リリース戦略** → **v1.5.1(JST バグ修正)→ v1.6.0(本機能)**の2段階
5. **htmlparser2 の依存追加** → **採用**(40KB、正規表現依存排除で堅牢性向上)
6. **auto_shortest レスポンスへの `raw` DateSearchResult 同梱** → **同梱しない**。`auto_shortest_applied` 内は簡潔な診断情報のみ。raw が欲しい場合は `search_delivery_date` を別途呼ぶ運用

## 15-b. 残リスク(実装中に要監視)

- ヤマトの HTML 文言変更による `PARSE_ERROR` 発生(リリース後の早期検知のため E2E テスト定期実行)
- 祝日・お盆・年末年始の時間帯表現パターン追加発覚(未確認)
- date API への過剰アクセスで bot 検知される可能性(バッチキャッシュで緩和、ただし超大量出荷時は rate limit 検討)

---

## 16. v1 からの差分サマリ(レビュー用)

| 変更項目 | v1 | v2 |
|---|---|---|
| 位置付け | 「最短日検索」 | 「**配達可否検知 + 最短日時自動差込**」 |
| `auto_shortest.cool` | あり | **削除**(既存 is_cool を尊重) |
| `auto_shortest` による `is_cool` 上書き | あり | **なし** |
| `auto_shortest` による `is_printing_date` 上書き | あり | **なし** |
| `shipment_date` 必須化 | 概念のみ | **superRefine で具体的実装** |
| service_type × is_cool マッピング | 未定義 | **明文化**(4/3/7/Aは非対応エラー) |
| 環境変数 | `DEFAULT_SHIPPER_ZIP` 新規 | **`B2_DEFAULT_SHIPPER_ZIP` 流用** |
| HTMLパーサ | 正規表現 | **htmlparser2 + domutils** |
| `normalizeShipmentDate` UTC バグ | 触れず | **同時修正(v1.5.1 で先行)** |
| JST 取得 | 実装未定 | **`Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Tokyo'})`** |
| バッチキャッシュキー | consigneeZip のみ | **shipperZip+consigneeZip+shipmentDate** |
| rationale の県名 | HTML から取得(不安定) | **ZIPのみ(v1.6.0)、県名マップは後続** |
| `includeRawHtml` | 返却あり | **本番環境では強制 false** |
| リリース戦略 | v1.6.0 一気 | **v1.5.1(JST修正)→ v1.6.0** |
| `auto_shortest` と `delivery_date` / `delivery_time_zone` の競合検知 | 未定義 | **superRefine で `CONFLICTING_FIELDS_WITH_AUTO_SHORTEST` エラー**(併用禁止) |
| `delivery_time_zone` スキーマ | `.default('0000')` | **`.optional()`**(ユーザー明示指定を判別可能にする。`inputToShipment()` で `?? '0000'` 補完、外形的挙動は維持) |
| タイムサービス(service_type=4) | v1.7.0 で対応予定 | **v1.6.0 で非対応が確定**(郵便番号精度の公開 API 不在、根拠を §15 に明記) |
| `PARA_CARRY_SEARCH` | v1.7.0 で対応予定 | **スコープ外として廃棄**(方向が異なり auto_shortest と無関係) |

---

この設計書は v2 として確定。実装着手前の最終レビュー推奨。
