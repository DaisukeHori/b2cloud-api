import type { Request, Response, NextFunction } from 'express';
import { login, resolveLoginConfig } from '../auth';

/**
 * B2 セッション自動作成ミドルウェア
 *
 * ★ステートレス方針: 各リクエストで新規ログインする（設計書 2-2 参照）
 *   - Vercel は本質的にステートレス、複数インスタンスでセッション共有不可
 *   - ログイン所要時間 3-5秒 は単発印刷の20秒に対し誤差範囲
 *
 * req.b2session に B2Session を注入する。
 */
export async function sessionMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const config = resolveLoginConfig(req.headers as any);
    req.b2session = await login(config);
    next();
  } catch (e) {
    next(e);
  }
}
