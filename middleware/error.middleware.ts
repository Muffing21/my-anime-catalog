/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextFunction, Request, Response } from "express";
import ApiError from "../types/api-error";

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (err instanceof ApiError) {
    return res.status(err.code).json({ code: err.code, error: err.message });
  }
  console.error("Unhandled error:", err);
  return res.status(500).json({ code: 500, error: "Something went wrong" });
};

export const errorRoute = (_req: Request, _res: Response, next: NextFunction) => {
  next(ApiError.notFound("Could not find this route."));
};
