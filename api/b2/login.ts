/**
 * POST /api/b2/login
 * B2クラウドにログインしセッションを確立
 *
 * @see 設計書 3-1〜3-5 / 8-1
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  handleCors,
  checkMethod,
  getSessionFromRequest,
  sendError,
} from '../_lib';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (handleCors(req, res)) return;
  if (!checkMethod(req, res, ['POST'])) return;

  try {
    const session = await getSessionFromRequest(req);
    res.status(200).json({
      status: 'ok',
      customerCode: session.customerCode,
      baseUrl: session.baseUrl,
      loginAt: session.loginAt.toISOString(),
      hasTemplate: session.template.length > 0,
      templateLines: session.template.length,
    });
  } catch (e) {
    sendError(res, e);
  }
}
