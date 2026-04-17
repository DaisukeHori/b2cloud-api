/**
 * 署名付きダウンロード URL の生成・検証
 *
 * ステートレスな HMAC-SHA256 署名方式:
 * - tracking_number + 有効期限を HMAC-SHA256 で署名
 * - MCP_API_KEY をシークレットキーとして使用
 * - 有効期限は生成から TTL_SECONDS 秒（デフォルト60秒）
 * - URL に sig, tn, exp を含む
 */

import { createHmac } from 'crypto';

const TTL_SECONDS = 60; // 有効期限: 1分

function getSecret(): string {
  return process.env.MCP_API_KEY || 'b2cloud-default-secret';
}

function sign(trackingNumber: string, exp: number): string {
  const payload = `${trackingNumber}:${exp}`;
  return createHmac('sha256', getSecret()).update(payload).digest('hex');
}

/**
 * 署名付きダウンロードパスを生成
 * @returns "/api/b2/download?tn=389717757822&exp=1776384000&sig=abc123..."
 */
export function generateSignedDownloadPath(trackingNumber: string): string {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const sig = sign(trackingNumber, exp);
  return `/api/b2/download?tn=${trackingNumber}&exp=${exp}&sig=${sig}`;
}

/**
 * 署名を検証し tracking_number を返す。
 * 失敗時は null と理由を返す。
 */
export function verifySignedDownload(
  tn: string | undefined,
  exp: string | undefined,
  sig: string | undefined
): { trackingNumber: string } | { error: string } {
  if (!tn || !exp || !sig) {
    return { error: 'Missing parameters: tn, exp, sig are required' };
  }

  const expNum = parseInt(exp, 10);
  if (isNaN(expNum)) {
    return { error: 'Invalid exp parameter' };
  }

  // 有効期限チェック
  const now = Math.floor(Date.now() / 1000);
  if (now > expNum) {
    return { error: `Download link expired (${now - expNum}s ago). Generate a new one.` };
  }

  // 署名検証
  const expectedSig = sign(tn, expNum);
  if (sig !== expectedSig) {
    return { error: 'Invalid signature' };
  }

  return { trackingNumber: tn };
}
