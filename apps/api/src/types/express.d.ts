import "express";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      apiScopes?: ("read" | "write")[];
      authKind?: "session" | "apikey";
    }
  }
}

export {};
