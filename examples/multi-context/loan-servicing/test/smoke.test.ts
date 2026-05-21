import { describe, it, expect } from "vitest";
import request from "supertest";
import { createServer } from "../src/server.js";

describe("loan-servicing", () => {
  it("returns ok on /health", async () => {
    const res = await request(createServer()).get("/health");
    expect(res.status).toBe(200);
  });

  it("services on POST /api/loans/service", async () => {
    const res = await request(createServer())
      .post("/api/loans/service")
      .send({ loanId: "loan-abc" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("serviced");
  });
});
