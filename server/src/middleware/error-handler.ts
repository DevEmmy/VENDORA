import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { logAvailability } from "../services/audit.service";
import { startupHint } from '../services/startup-diagnostics';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
export const asyncRoute =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve()
      .then(() => handler(req, res, next))
      .catch(next);
  };
export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  _next,
) => {
  const status =
    error instanceof HttpError
      ? error.status
      : typeof error === "object" &&
          error !== null &&
          "type" in error &&
          error.type === "entity.too.large"
        ? 413
        : error instanceof SyntaxError || error instanceof ZodError
          ? 400
          : 503;
  if (status === 503) logAvailability("request-unavailable", res.locals.requestId, {
    operation: 'http-request', hint: startupHint('application', error),
  });
  res.status(status).json({
    error:
      error instanceof HttpError
        ? error.message
        : status === 400
          ? "Invalid JSON"
          : "Service unavailable",
    requestId: res.locals.requestId,
    ...(error instanceof HttpError && error.code ? { code: error.code } : {}),
    ...(error instanceof HttpError && error.details ? { details: error.details } : {}),
  });
};
