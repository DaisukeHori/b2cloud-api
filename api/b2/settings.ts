/**
 * GET /api/b2/settings      現在のプリンタ設定を取得
 * PUT /api/b2/settings      printer_type 切替（read-modify-write）
 *
 * Body (PUT): { printer_type: "1" | "2" | "3" }
 *
 * @see 設計書 4-1 / 5-3 / 5-3-3
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  handleCors,
  checkMethod,
  requireApiKey,
  getSessionFromRequest,
  sendError,
  getBody,
} from '../_lib';
import { setPrinterTypeSchema } from '../../src/validation';
import { getSettings, setPrinterType } from '../../src/settings';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (handleCors(req, res)) return;
  if (requireApiKey(req, res)) return;
  if (!checkMethod(req, res, ['GET', 'PUT'])) return;

  try {
    const session = await getSessionFromRequest(req);

    if (req.method === 'GET') {
      const entry = await getSettings(session);
      const gs = (entry as any).general_settings ?? {};
      res.status(200).json({
        printer_type: gs.printer_type,
        multi_paper_flg: gs.multi_paper_flg,
        is_tax_rate: gs.is_tax_rate,
        shipment_date_from: gs.shipment_date_from,
        shipment_date_to: gs.shipment_date_to,
        raw: gs,
      });
      return;
    }

    // PUT
    const input = setPrinterTypeSchema.parse(getBody(req));
    const before = await getSettings(session);
    const beforeType =
      ((before as any).general_settings ?? {}).printer_type as
        | string
        | undefined;
    await setPrinterType(session, input.printer_type);
    res
      .status(200)
      .json({ success: true, before: beforeType, after: input.printer_type });
  } catch (e) {
    sendError(res, e);
  }
}
