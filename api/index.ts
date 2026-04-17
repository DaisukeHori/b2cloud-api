/**
 * Vercel Serverless Function エントリポイント
 *
 * Express app を export default するだけ。
 * Vercel が全リクエストをこの関数にルーティングする。
 */
import app from '../src/app';

export default app;
