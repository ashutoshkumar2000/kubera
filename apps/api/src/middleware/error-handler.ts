
import type { ErrorRequestHandler } from "express";
import { AppError } from "./app-error.js";

export const errorHandler: ErrorRequestHandler = (
  error,
  _req,
  res,
  _next,
) => {
  if (res.headersSent) {
    return;
  }

  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: error.message,
    });
    return;
  }

  // Log unexpected errors internally, without exposing details to clients.
  console.error(
    "Unhandled API error:",
    error instanceof Error ? error.message : "Unknown error",
  );

  res.status(500).json({
    error: "Internal server error",
  });
};
