/**
 * GET /api/b2/saved        保存済み伝票一覧（service_type で絞込可）
 * DELETE /api/b2/saved     保存済み伝票削除（body: { ids: [UMN...] }）
 *
 * @see 設計書 4-11 / 8-2 / 8-3
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import {
  handleCors,
  checkMethod,
  getSessionFromRequest,
  sendError,
  getBody,
} from '../_lib';
import {
  listSavedShipments,
  deleteSavedShipments,
} from '../../src/shipment';
import type { FeedEntry, Shipment, ServiceType } from '../../src/types';

const deleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

function q(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (handleCors(req, res)) return;
  if (!checkMethod(req, res, ['GET', 'DELETE'])) return;

  try {
    const session = await getSessionFromRequest(req);

    if (req.method === 'GET') {
      const serviceType = q(req.query.service_type as any) as
        | ServiceType
        | undefined;
      const entries = await listSavedShipments(session, serviceType);
      const limited = entries.slice(0, 100);
      res.status(200).json({
        total: entries.length,
        returned: limited.length,
        entries: limited.map((e) => ({
          id: e.id,
          tracking_number: e.shipment?.tracking_number,
          service_type: e.shipment?.service_type,
          consignee_name: e.shipment?.consignee_name,
          search_key4: e.shipment?.search_key4,
        })),
      });
      return;
    }

    // DELETE
    const input = deleteSchema.parse(getBody(req));
    const all = await listSavedShipments(session);
    const targets: FeedEntry<Shipment>[] = [];
    for (const id of input.ids) {
      const found = all.find((e) => e.shipment?.tracking_number === id);
      if (found) targets.push(found);
    }
    if (targets.length === 0) {
      res.status(404).json({
        error: 'NotFound',
        message: '削除対象の伝票が見つかりません',
      });
      return;
    }
    await deleteSavedShipments(session, targets);
    res.status(200).json({ deleted: targets.length });
  } catch (e) {
    sendError(res, e);
  }
}
