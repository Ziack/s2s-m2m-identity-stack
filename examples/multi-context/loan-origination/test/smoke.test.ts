import { describe, it, expect } from "vitest";
import request from "supertest";
import { createServer } from "../src/server.js";

describe("loan-origination", () => {
  it("returns ok on /health", async () => {
    const res = await request(createServer()).get("/health");
    expect(res.status).toBe(200);
  });

  it("originates on POST /api/loans/originate", async () => {
    const res = await request(createServer())
      .post("/api/loans/originate")
      .send({ amount: 1000 });
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^loan-/);
  });
});
