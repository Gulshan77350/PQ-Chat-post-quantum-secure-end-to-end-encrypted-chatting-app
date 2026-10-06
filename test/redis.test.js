import { test } from "node:test";
import assert from "node:assert/strict";
import RedisMock from "ioredis-mock";
import { redisStore, memoryStore, ENTRY_TTL_MS } from "../lib/presence.js";
import { hitRedis } from "../lib/rateLimit.js";

for (const [name, make] of [["memory", () => memoryStore()], ["redis", () => redisStore(new RedisMock())]]) {
  test(`${name} presence: multiple tabs keep a user online until the last one closes`, async () => {
    const p = make();
    assert.equal(await p.add("alice", "s1"), true, "first socket → came online");
    assert.equal(await p.add("alice", "s2"), false, "second tab → already online");
    assert.deepEqual(await p.onlineUsers(), ["alice"]);
    assert.equal(await p.remove("alice", "s1"), false, "one tab closed → still online");
    assert.equal(await p.isOnline("alice"), true);
    assert.equal(await p.remove("alice", "s2"), true, "last tab closed → offline");
    assert.equal(await p.isOnline("alice"), false);
    assert.deepEqual(await p.onlineUsers(), []);
  });
}

test("redis presence: entries from a crashed instance expire", async () => {
  const redis = new RedisMock();
  const p = redisStore(redis);
  await p.add("bob", "dead-socket");
  // Simulate the owning instance dying: its heartbeat stops and the expiry passes.
  await redis.zadd("presence:users", Date.now() - 1, "bob");
  assert.equal(await p.isOnline("bob"), false);
  assert.deepEqual(await p.onlineUsers(), []);
  assert.ok(ENTRY_TTL_MS > 0);
});

test("redis sliding-window limiter counts only hits inside the window", async () => {
  const redis = new RedisMock();
  const t0 = 1_000_000;
  assert.equal(await hitRedis(redis, "rl:k", 1000, t0), 1);
  assert.equal(await hitRedis(redis, "rl:k", 1000, t0 + 100), 2);
  assert.equal(await hitRedis(redis, "rl:k", 1000, t0 + 500), 3);
  // t0 and t0+100 have slid out of the window.
  assert.equal(await hitRedis(redis, "rl:k", 1000, t0 + 1150), 2);
});
