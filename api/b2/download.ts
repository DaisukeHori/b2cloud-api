/**
 * GET /api/b2/download?tn={tracking_number}&exp={expiry}&sig={signature}
 *
 * 署名付き有効期限ダウンロード URL。
 * MCP の create_and_print_shipment が返すダウンロード URL のバックエンド。
 *
 * - HMAC-SHA256 署名で改ざん防止
 * - 有効期限 60 秒（生成時から）
 * - API キー不要（署名自体が認証を兼ねる）
 * - ファイル名: {tracking_number}.pdf
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleCors, checkMethod, getSessionFromRequest, sendError } from '../_lib';
import { verifySignedDownload } from '../../src/signed-url';
import { reprintFullFlow } from '../../src/print';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (handleCors(req, res)) return;
  if (!checkMethod(req, res, ['GET'])) return;

  // 署名検証（API キー不要、署名自体が認証）
  const tn = typeof req.query.tn === 'string' ? req.query.tn : undefined;
  const exp = typeof req.query.exp === 'string' ? req.query.exp : undefined;
  const sig = typeof req.query.sig === 'string' ? req.query.sig : undefined;

  const result = verifySignedDownload(tn, exp, sig);
  if ('error' in result) {
    res.status(403).json({ error: 'Forbidden', message: result.error });
    return;
  }

  try {
    const printType =
      typeof req.query.print_type === 'string' ? req.query.print_type : 'm5';

    const session = await getSessionFromRequest(req);
    const pdfResult = await reprintFullFlow(
      session,
      result.trackingNumber,
      printType as any
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${result.trackingNumber}.pdf"`
    );
    res.setHeader('Content-Length', pdfResult.pdf.length.toString());
    res.status(200).send(Buffer.from(pdfResult.pdf));
  } catch (e) {
    sendError(res, e);
  }
}
