/**
 * POST /api/b2/save
 * checkonly → 保存（複数伝票対応）
 *
 * Body: { shipments: [{ ...input }] }
 * Response: { saved: [{ tracking_number, id, href }] }
 *
 * @see 設計書 4-3 / 8-2
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import {
  handleCors,
  checkMethod,
  requireApiKey,
  getSessionFromRequest,
  sendError,
  getBody,
} from '../_lib';
import { checkShipment, saveShipment } from '../../src/shipment';
import {
  shipmentInputSchema,
  inputToShipment,
  getDefaultShipperFromEnv,
} from '../../src/validation';

const bodySchema = z.object({
  shipments: z.array(shipmentInputSchema).min(1),
});

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (handleCors(req, res)) return;
  if (requireApiKey(req, res)) return;
  if (!checkMethod(req, res, ['POST'])) return;

  try {
    const input = bodySchema.parse(getBody(req));
    const session = await getSessionFromRequest(req);
    const defaults = getDefaultShipperFromEnv();

    const saved = [];
    for (const s of input.shipments) {
      const shipment = inputToShipment(s, defaults);
      const checked = await checkShipment(session, shipment);
      const savedEntry = await saveShipment(session, checked);
      saved.push({
        tracking_number: savedEntry.shipment?.tracking_number,
        id: savedEntry.id,
        href: savedEntry.link?.[0]?.___href,
      });
    }

    res.status(200).json({ saved });
  } catch (e) {
    sendError(res, e);
  }
}
