/**
 * GET /api/b2/download — 署名付き PDF ダウンロード
 *
 * API キー不要（HMAC-SHA256 署名で認証）。
 * session middleware は app.ts で個別適用される。
 */

import { Router } from 'express';
import { verifySignedDownload } from '../signed-url';
import { reprintFullFlow } from '../print';

const router = Router();

/**
 * @openapi
 * /api/b2/download:
 *   get:
 *     summary: 署名付き PDF ダウンロード（60秒有効）
 *     tags: [B2]
 *     parameters:
 *       - name: tn
 *         in: query
 *         required: true
 *         schema: { type: string }
 *         description: 追跡番号
 *       - name: exp
 *         in: query
 *         required: true
 *         schema: { type: string }
 *         description: 有効期限（Unix timestamp）
 *       - name: sig
 *         in: query
 *         required: true
 *         schema: { type: string }
 *         description: HMAC-SHA256 署名
 *     responses:
 *       200:
 *         description: PDF バイナリ
 *         content:
 *           application/pdf: {}
 *       403:
 *         description: 署名不正または期限切れ
 */
router.get('/', async (req, res, next) => {
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

    const session = req.b2session!;
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
    next(e);
  }
});

export default router;
