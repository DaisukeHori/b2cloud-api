import type { Request, Response, NextFunction } from 'express';
import { B2CloudError, B2ValidationError } from '../b2client';
import { DateApiError } from '../date';
import { ZodError } from 'zod';

/**
 * Express エラーハンドリングミドルウェア（4引数）
 */
export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof B2ValidationError) {
    res.status(400).json({
      error: 'ValidationError',
      message: err.message,
      errors: err.errors,
      _debug_raw: err.rawResponse,
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'ValidationError',
      message: `入力エラー: ${JSON.stringify(err.errors)}`,
      errors: err.errors,
    });
    return;
  }

  if (err instanceof DateApiError) {
    res.status(err.statusCode).json({
      error: err.name,
      code: err.code,
      message: err.message,
    });
    return;
  }

  if (err instanceof B2CloudError) {
    res.status(err.statusCode).json({
      error: 'B2CloudError',
      message: err.message,
      statusCode: err.statusCode,
    });
    return;
  }

  if (err instanceof Error) {
    res.status(500).json({
      error: err.name,
      message: err.message,
    });
    return;
  }

  res.status(500).json({ error: 'InternalError', message: String(err) });
}
