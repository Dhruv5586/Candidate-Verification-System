import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // 1. Handle Zod schema validation errors
  if (err instanceof ZodError) {
    const details = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    const summary = details
      .map((d) => (d.field ? `${d.field}: ${d.message}` : d.message))
      .join('; ');

    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: summary ? `Invalid request data: ${summary}` : 'Invalid request data',
        details,
      },
    });
    return;
  }

  // 2. Handle structured operational application errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }

  // 2b. Handle Multer file upload errors (e.g. LIMIT_FILE_SIZE)
  if ((err as any).name === 'MulterError') {
    const multerErr = err as any;
    const message =
      multerErr.code === 'LIMIT_FILE_SIZE'
        ? `File exceeds maximum allowed size. CSV imports support up to ${env.MAX_CSV_SIZE_MB || 100}MB.`
        : `Upload error: ${multerErr.message}`;
    res.status(400).json({
      success: false,
      error: {
        code: 'FILE_TOO_LARGE',
        message,
      },
    });
    return;
  }

  // 3. Handle unhandled unexpected errors
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled internal server error');

  const message = env.NODE_ENV === 'production'
    ? 'An unexpected internal error occurred'
    : err.message || 'An unexpected internal error occurred';

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message,
      ...(env.NODE_ENV !== 'production' && err.stack ? { stack: err.stack } : {}),
    },
  });
}
