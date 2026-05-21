import express, { type Express } from "express";

export function createServer(): Express {
  const app = express();
  app.use(express.json());
  app.get("/health", (_req, res) => res.status(200).json({ ok: true }));
  app.post("/api/loans/originate", (_req, res) => {
    const id = `loan-${Date.now()}`;
    res.status(201).json({ id, status: "originated" });
  });
  return app;
}
