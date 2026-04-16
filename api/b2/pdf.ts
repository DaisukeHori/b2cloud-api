/**
 * GET /api/b2/pdf?issue_no={no}
 * issue_no で PDF を直接取得（バイナリ返却、Content-Type: application/pdf）
 *
 * ★設計書 4-5 参照: checkonly=1 → fileonly=1 の2段階必須
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  handleCors,
  checkMethod,
  getSessionFromRequest,
  sendError,
} from '../_lib';
import { downloadPdf } from '../../src/print';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (handleCors(req, res)) return;
  if (!checkMethod(req, res, ['GET'])) return;

  try {
    const issueNo =
      typeof req.query.issue_no === 'string'
        ? req.query.issue_no
        : Array.isArray(req.query.issue_no)
          ? req.query.issue_no[0]
          : undefined;

    if (!issueNo) {
      res
        .status(400)
        .json({ error: 'BadRequest', message: 'issue_no パラメータ必須' });
      return;
    }

    const session = await getSessionFromRequest(req);
    const pdf = await downloadPdf(session, issueNo);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${issueNo}.pdf"`
    );
    res.setHeader('Content-Length', pdf.length.toString());
    res.status(200).send(Buffer.from(pdf));
  } catch (e) {
    sendError(res, e);
  }
}
