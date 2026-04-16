/**
 * POST /api/b2/reprint
 * 発行済み伝票を再印刷（PUT /history?reissue → polling → checkonly=1 → fileonly=1）
 *
 * Body: { tracking_number, print_type?, output_format? }
 * Response: { issue_no, pdf_base64, pdf_size }
 *
 * @see 設計書 4-7 / 8-2
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  handleCors,
  checkMethod,
  getSessionFromRequest,
  sendError,
  getBody,
} from '../_lib';
import { reprintSchema } from '../../src/validation';
import { reprintFullFlow } from '../../src/print';
import { reprintWithFormat } from '../../src/settings';
import { searchHistory } from '../../src/shipment';
import { toBase64 } from '../../src/utils';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (handleCors(req, res)) return;
  if (!checkMethod(req, res, ['POST'])) return;

  try {
    const input = reprintSchema.parse(getBody(req));
    const session = await getSessionFromRequest(req);

    if (input.output_format) {
      // 既存伝票の service_type を取得
      const entries = await searchHistory(session, {
        trackingNumber: input.tracking_number,
      });
      if (entries.length === 0) {
        res.status(404).json({
          error: 'NotFound',
          message: `対象伝票が見つかりません: ${input.tracking_number}`,
        });
        return;
      }
      const result = await reprintWithFormat(
        session,
        input.tracking_number,
        input.output_format,
        entries[0].shipment?.service_type as any
      );
      res.status(200).json({
        issue_no: result.issueNo,
        pdf_size: result.pdfSize,
        pdf_base64: toBase64(result.pdf),
      });
      return;
    }

    const result = await reprintFullFlow(
      session,
      input.tracking_number,
      input.print_type ?? 'm5'
    );

    res.status(200).json({
      issue_no: result.issueNo,
      pdf_size: result.pdfSize,
      polling_attempts: result.pollingAttempts,
      pdf_base64: toBase64(result.pdf),
    });
  } catch (e) {
    sendError(res, e);
  }
}
