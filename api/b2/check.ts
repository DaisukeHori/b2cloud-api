/**
 * POST /api/b2/check
 * バリデーションのみ（checkonly）、複数伝票対応
 *
 * Body: { shipments: [{ ...input }] }
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
import { checkShipment } from '../../src/shipment';
import {
  shipmentInputSchema,
  inputToShipment,
  getDefaultShipperFromEnv,
} from '../../src/validation';
import { B2ValidationError } from '../../src/b2client';

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

    const results = [];
    for (const s of input.shipments) {
      try {
        const shipment = inputToShipment(s, defaults);
        const entry = await checkShipment(session, shipment);
        results.push({
          valid: true,
          error_flg: entry.shipment?.error_flg,
          tracking_number: entry.shipment?.tracking_number,
          checked_date: entry.shipment?.checked_date,
        });
      } catch (e) {
        if (e instanceof B2ValidationError) {
          results.push({ valid: false, errors: e.errors });
        } else {
          results.push({
            valid: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    res.status(200).json({ results });
  } catch (e) {
    sendError(res, e);
  }
}
