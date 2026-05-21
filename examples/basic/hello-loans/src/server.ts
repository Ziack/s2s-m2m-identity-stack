import express, { type Express } from "express";

export function createServer(): Express {
  const app = express();
  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.get("/api/hello", (_req, res) => {
    res.status(200).json({ message: "hello, loans" });
  });
  return app;
}
