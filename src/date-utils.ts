/**
 * JST 基準の日付ユーティリティ
 *
 * ヤマト運輸は日本国内サービスなので、タイムゾーンは常に Asia/Tokyo に固定。
 * Vercel の Node Runtime はデフォルト TZ=UTC のため、new Date() だけでは
 * JST 0時〜9時に前日の日付が返るバグがある。
 *
 * @see docs/date-feature-design_v2.md §3
 */

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

/**
 * ICU full-icu が利用可能か検証。
 * Node 20+ の standard build は Asia/Tokyo を含むフル ICU 対応。
 * Vercel の Node 22 ランタイムも full-icu。
 * 使えない環境では即座にエラーにする。
 */
export function assertIcuAvailable(): void {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(
      new Date()
    );
  } catch (e) {
    throw new Error(
      `ICU full-icu が利用できません。Node を --with-intl=full-icu でビルドするか、` +
        `Vercel の Node Runtime を使ってください。original: ${e}`
    );
  }
}

/**
 * 郵便番号をハイフンなし7桁に正規化する。
 * 「332-0015」→「3320015」、全角ハイフンにも対応。
 */
export function normalizeZip(zip: string): string {
  return zip.replace(/[-ー－]/g, '').replace(/\s/g, '');
}
