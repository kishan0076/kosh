import type { NextFunction, Request, Response } from "express";

/** A typed, client-safe error with an HTTP status. */
export class AppError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new AppError(code, message, 400, details);
export const unauthorized = (message = "Sign in to continue.") => new AppError("UNAUTHORIZED", message, 401);
export const forbidden = (message = "Not allowed.") => new AppError("FORBIDDEN", message, 403);
export const notFound = (message = "Not found.") => new AppError("NOT_FOUND", message, 404);

/** Wrap an async route handler so thrown errors reach the error middleware. */
export function ah<T extends Request>(fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
}
