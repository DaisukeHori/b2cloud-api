/**
 * GET /api/b2/tracking?search_key4={key}
 *     /api/b2/tracking?tracking_number={12桁}
 *
 * search_key4 または tracking_number から 12桁追跡番号 / 伝票情報を取得
 *
 * @see 設計書 4-5 / 8-3
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  handleCors,
  checkMethod,
  getSessionFromRequest,
  sendError,
} from '../_lib';
import { searchHistory } from '../../src/shipment';

function q(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (handleCors(req, res)) return;
  if (!checkMethod(req, res, ['GET'])) return;

  try {
    const searchKey4 = q(req.query.search_key4 as any);
    const trackingNumber = q(req.query.tracking_number as any);

    if (!searchKey4 && !trackingNumber) {
      res.status(400).json({
        error: 'BadRequest',
        message: 'search_key4 または tracking_number のいずれか必須',
      });
      return;
    }

    const session = await getSessionFromRequest(req);
    const entries = await searchHistory(session, {
      searchKey4: searchKey4,
      trackingNumber: trackingNumber,
    });

    if (entries.length === 0) {
      res.status(404).json({
        error: 'NotFound',
        message: '該当伝票が見つかりません',
      });
      return;
    }

    const first = entries[0];
    res.status(200).json({
      tracking_number: first.shipment?.tracking_number,
      service_type: first.shipment?.service_type,
      consignee_name: first.shipment?.consignee_name,
      shipment_date: first.shipment?.shipment_date,
      created: first.shipment?.created,
      search_key4: first.shipment?.search_key4,
    });
  } catch (e) {
    sendError(res, e);
  }
}
