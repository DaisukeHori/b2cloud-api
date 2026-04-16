/**
 * GET /api/b2/history
 * 発行済み伝票履歴検索
 *
 * Query: tracking_number?, search_key4?, service_type?, from_date?, to_date?
 * Response: { entries: [...], total }
 *
 * @see 設計書 8-3
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  handleCors,
  checkMethod,
  getSessionFromRequest,
  sendError,
} from '../_lib';
import { historySearchSchema } from '../../src/validation';
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
    const params = historySearchSchema.parse({
      tracking_number: q(req.query.tracking_number as any),
      search_key4: q(req.query.search_key4 as any),
      service_type: q(req.query.service_type as any),
      from_date: q(req.query.from_date as any),
      to_date: q(req.query.to_date as any),
    });

    const session = await getSessionFromRequest(req);
    const entries = await searchHistory(session, {
      trackingNumber: params.tracking_number,
      searchKey4: params.search_key4,
      serviceType: params.service_type,
      dateFrom: params.from_date,
      dateTo: params.to_date,
    });

    // 最大100件まで返す（1リクエストの応答サイズ抑制）
    const limited = entries.slice(0, 100);

    res.status(200).json({
      total: entries.length,
      returned: limited.length,
      entries: limited.map((e) => ({
        id: e.id,
        tracking_number: e.shipment?.tracking_number,
        service_type: e.shipment?.service_type,
        consignee_name: e.shipment?.consignee_name,
        consignee_address1: e.shipment?.consignee_address1,
        shipment_date: e.shipment?.shipment_date,
        created: e.shipment?.created,
        search_key4: e.shipment?.search_key4,
      })),
    });
  } catch (e) {
    sendError(res, e);
  }
}
