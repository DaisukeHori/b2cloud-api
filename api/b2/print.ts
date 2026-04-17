/**
 * POST /api/b2/print
 * checkonly → 保存 → 印刷 → PDF取得 → 12桁追跡番号取得（フル E2E）
 *
 * Body: { shipments: [{...}], print_type?, output_format? }
 * Response: { results: [{ tracking_number, issue_no, pdf_base64, ... }] }
 *
 * @see 設計書 4-5 / 4-8 / 8-2
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
import {
  shipmentInputSchema,
  inputToShipment,
  getDefaultShipperFromEnv,
  printTypeSchema,
  outputFormatSchema,
} from '../../src/validation';
import { createAndPrint } from '../../src/print';
import { printWithFormat } from '../../src/settings';
import { toBase64 } from '../../src/utils';

const bodySchema = z.object({
  shipments: z.array(shipmentInputSchema).min(1),
  print_type: printTypeSchema.optional(),
  output_format: outputFormatSchema.optional(),
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
    const printType =
      input.print_type ??
      (process.env.B2_DEFAULT_PRINT_TYPE as any) ??
      'm5';

    const results = [];
    for (const s of input.shipments) {
      const shipment = inputToShipment(s, defaults);
      if (input.output_format) {
        const r = await printWithFormat(session, shipment, input.output_format);
        results.push({
          tracking_number: r.trackingNumber,
          internal_tracking: r.internalTracking,
          issue_no: r.issueNo,
          search_key4: r.searchKey4,
          pdf_size: r.pdfSize,
          pdf_download_path: `/api/b2/download?tracking_number=${r.trackingNumber}`,
          pdf_base64: toBase64(r.pdf),
        });
      } else {
        const r = await createAndPrint(session, shipment, printType);
        results.push({
          tracking_number: r.trackingNumber,
          internal_tracking: r.internalTracking,
          issue_no: r.issueNo,
          search_key4: r.searchKey4,
          polling_attempts: r.pollingAttempts,
          tracking_attempts: r.trackingAttempts,
          pdf_size: r.pdfSize,
          pdf_download_path: `/api/b2/download?tracking_number=${r.trackingNumber}`,
          pdf_base64: toBase64(r.pdf),
        });
      }
    }

    res.status(200).json({ results });
  } catch (e) {
    sendError(res, e);
  }
}
