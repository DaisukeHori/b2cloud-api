/**
 * GET /api/health
 * ヘルスチェックエンドポイント（認証不要）
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleCors, checkMethod } from './_lib';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (handleCors(req, res)) return;
  if (!checkMethod(req, res, ['GET'])) return;

  res.status(200).json({
    status: 'ok',
    service: 'b2cloud-api',
    version: '0.1.0',
    time: new Date().toISOString(),
  });
}
