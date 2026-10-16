import type { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodType } from 'zod';

/**
 * Formato único de error de la API: `{ message: string }` (+ `issues` en validación).
 * Los controladores lanzan `HttpError` (o dejan propagar errores de Mongo/zod) y
 * capturan con `handleError`, que decide el status y nunca filtra detalles internos.
 */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (msg: string)   => new HttpError(400, msg);
export const forbidden  = (msg = 'Permiso denegado') => new HttpError(403, msg);
export const notFound   = (msg: string)   => new HttpError(404, msg);
export const conflict   = (msg: string)   => new HttpError(409, msg);

export function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ message });
}

export function handleError(res: Response, err: unknown, context?: string): void {
  if (res.headersSent) return;

  if (err instanceof HttpError) { sendError(res, err.status, err.message); return; }

  if (err instanceof ZodError) {
    const first = err.issues[0];
    const path  = first?.path?.join('.') ?? '';
    res.status(400).json({
      message: first ? `${path ? path + ': ' : ''}${first.message}` : 'Datos inválidos.',
      issues: err.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }

  const e = err as { code?: number; name?: string; message?: string };
  if (e?.code === 11000)            { sendError(res, 409, 'Ya existe un registro con ese valor.'); return; }
  if (e?.name === 'CastError')      { sendError(res, 400, 'Identificador inválido.'); return; }
  if (e?.name === 'ValidationError') { sendError(res, 400, 'Datos inválidos.'); return; }

  console.error(context ? `[${context}]` : '[api]', err);
  sendError(res, 500, 'Error del servidor.');
}

/** Valida y tipa un payload; lanza ZodError (→ 400 vía handleError). */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  return schema.parse(data);
}

/** Middleware final de Express: cualquier error que llegue por next(err). */
export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  handleError(res, err, `${req.method} ${req.originalUrl}`);
}
