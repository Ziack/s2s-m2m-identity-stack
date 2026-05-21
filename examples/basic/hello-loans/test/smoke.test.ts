import { describe, it, expect } from "vitest";
import request from "supertest";
import { createServer } from "../src/server.js";

describe("hello-loans", () => {
  it("returns ok on /health", async () => {
    const res = await request(createServer()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("returns hello payload on /api/hello", async () => {
    const res = await request(createServer()).get("/api/hello");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "hello, loans" });
  });
});
