/**
 * GET /api/b2/download?tracking_number={tn}
 *
 * 追跡番号から送り状 PDF を直接ダウンロードする簡易エンドポイント。
 * 内部で reprint フロー（再印刷→polling→PDF取得）を実行する。
 *
 * ブラウザで開くとPDFが表示され、curl -O で保存できる。
 * ファイル名は {tracking_number}.pdf。
 *
 * MCP の create_and_print_shipment が返すダウンロード URL のバックエンド。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  handleCors,
  checkMethod,
  requireApiKey,
  getSessionFromRequest,
  sendError,
} from '../_lib';
import { reprintFullFlow } from '../../src/print';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (handleCors(req, res)) return;
  if (requireApiKey(req, res)) return;
  if (!checkMethod(req, res, ['GET'])) return;

  try {
    const trackingNumber =
      typeof req.query.tracking_number === 'string'
        ? req.query.tracking_number
        : Array.isArray(req.query.tracking_number)
          ? req.query.tracking_number[0]
          : undefined;

    if (!trackingNumber) {
      res.status(400).json({
        error: 'BadRequest',
        message: 'tracking_number パラメータ必須（ヤマト12桁追跡番号）',
      });
      return;
    }

    const printType =
      typeof req.query.print_type === 'string'
        ? req.query.print_type
        : 'm5';

    const session = await getSessionFromRequest(req);
    const result = await reprintFullFlow(session, trackingNumber, printType as any);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${trackingNumber}.pdf"`
    );
    res.setHeader('Content-Length', result.pdf.length.toString());
    res.status(200).send(Buffer.from(result.pdf));
  } catch (e) {
    sendError(res, e);
  }
}
