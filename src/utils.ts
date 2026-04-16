/**
 * ユーティリティ（汎用ヘルパー）
 */

/**
 * Uint8Array / Buffer を base64 文字列に変換
 */
export function toBase64(bytes: Uint8Array): string {
  // Node.js の Buffer を使用（Vercel Node runtime で動作）
  return Buffer.from(bytes).toString('base64');
}

/**
 * base64 文字列を Uint8Array に変換
 */
export function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/**
 * エラーメッセージを安全に取得
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
