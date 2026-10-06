import { test } from "node:test";
import assert from "node:assert/strict";
import { getClientIp, applyRateLimit } from "../lib/rateLimit.js";

const req = (xff, remote = "10.1.1.1") => ({
  headers: xff ? { "x-forwarded-for": xff } : {},
  socket: { remoteAddress: remote },
  url: "/api/x",
});

test("X-Forwarded-For is ignored unless TRUST_PROXY is set", () => {
  assert.equal(getClientIp(req("1.2.3.4"), undefined), "10.1.1.1");
  assert.equal(getClientIp(req("1.2.3.4"), "0"), "10.1.1.1");
});

test("with one trusted proxy, a client-forged XFF prefix is ignored", () => {
  // Attacker sends "X-Forwarded-For: 6.6.6.6"; nginx appends the real client 203.0.113.9.
  assert.equal(getClientIp(req("6.6.6.6, 203.0.113.9"), "1"), "203.0.113.9");
});

test("with two trusted proxies the client is two hops from the right", () => {
  assert.equal(getClientIp(req("6.6.6.6, 203.0.113.9, 172.16.0.2"), "2"), "203.0.113.9");
});

test("limiter returns 429 after the limit and sets headers", async () => {
  const res = {
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; },
    json() { return this; },
  };
  const opts = { name: "unit-test", key: "user-1", limit: 3, windowMs: 1000 };
  for (let i = 0; i < 3; i++) assert.equal(await applyRateLimit(req(), res, opts), true);
  assert.equal(await applyRateLimit(req(), res, opts), false);
  assert.equal(res.code, 429);
  assert.equal(res.headers["Retry-After"], 1);
  // A different identity has its own bucket.
  assert.equal(await applyRateLimit(req(), res, { ...opts, key: "user-2" }), true);
});
