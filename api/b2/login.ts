/**
 * POST /api/b2/login
 *
 * B2クラウドへの接続/認証テスト用エンドポイント
 *
 * ★ステートレス方針 (api/_lib.ts 参照):
 *   このエンドポイントは「セッションをサーバー側に保持する」用途ではなく、
 *   認証情報が正しいか・B2クラウドに到達できるかを確認するためのもの。
 *   各リクエストで新規ログイン → セッション情報のサマリを返却 → 終了。
 *   後続リクエストで再利用される Cookie 等は返さない。
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
      message: '認証成功（ステートレス方式: セッションは保持されません）',
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
