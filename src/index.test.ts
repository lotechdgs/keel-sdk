import { describe, expect, it } from "vitest";
import { accountUserId, KeelApiError, KeelClient, fromUnits, toUnits, verifyWebhookSignature } from "./index";

const TEST_KEY = `keel_test_${"a".repeat(64)}`;
const LIVE_KEY = `keel_live_${"b".repeat(64)}`;

function mockFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fn, calls };
}

describe("toUnits / fromUnits", () => {
  it("converts decimals to six-decimal units and back", () => {
    expect(toUnits("1.5")).toBe("1500000");
    expect(toUnits(2)).toBe("2000000");
    expect(toUnits("0.000001")).toBe("1");
    expect(fromUnits("1500000")).toBe("1.5");
    expect(fromUnits("2000000")).toBe("2");
    expect(fromUnits("1")).toBe("0.000001");
  });
  it("rejects invalid or zero amounts", () => {
    expect(() => toUnits("0")).toThrow();
    expect(() => toUnits("-5")).toThrow();
    expect(() => toUnits("1.1234567")).toThrow();
    expect(() => toUnits("abc")).toThrow();
    expect(() => fromUnits("1.5")).toThrow();
  });
});

describe("KeelClient", () => {
  it("sends user profit preference and service-independent TEST profit with stable keys", async () => {
    const { fn, calls } = mockFetch(200, { environment: "sandbox" });
    const client = new KeelClient({ apiKey: TEST_KEY, baseUrl: "https://example.test", fetch: fn });
    await client.setProfitProtection("u1", { enabled: true, percentage: 5 }, { idempotencyKey: "settings_123" });
    await client.creditProfit("u1", "profit_1", "creator_rewards", "100", { idempotencyKey: "profit_123" });
    expect(calls[0].url).toBe("https://example.test/api/public/keel/sandbox/v1/profit-settings");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ user_id: "u1", preference: { enabled: true, percentage: 5 } });
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ user_id: "u1", profit_id: "profit_1", service: "creator_rewards", amount: "100000000" });
    expect((calls[1].init.headers as Record<string, string>)["Idempotency-Key"]).toBe("profit_123");
    for (const percentage of [4, 101, NaN]) expect(() => client.setProfitProtection("u1", { enabled: true, percentage })).toThrow();
  });
  it("never sends arbitrary profit credits to Live", () => {
    const { fn, calls } = mockFetch(200, {});
    const client = new KeelClient({ apiKey: LIVE_KEY, fetch: fn });
    expect(() => client.creditProfit("u1", "p1", "rewards", 100)).toThrow("operation_not_allowed");
    expect(calls).toHaveLength(0);
  });
  it("uses Web2 account IDs without requiring a wallet or chain", async () => {
    const { fn, calls } = mockFetch(200, { environment: "sandbox", asset: "TEST" });
    const client = new KeelClient({ apiKey: TEST_KEY, baseUrl: "https://example.test", fetch: fn });
    await client.creditWallet(accountUserId("account_42"), "25.50", { idempotencyKey: "topup-42" });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ user_id: "account_42", amount: "25500000" });
    expect((calls[0].init.headers as Record<string, string>)["Idempotency-Key"]).toBe("topup-42");
  });
  it("rejects invalid account IDs before issuing a request", () => {
    expect(() => accountUserId("user@example.com")).toThrow();
    expect(() => accountUserId("a".repeat(65))).toThrow();
    expect(accountUserId("a".repeat(64))).toHaveLength(64);
  });
  it("rejects malformed keys", () => {
    expect(() => new KeelClient({ apiKey: "nope" })).toThrow();
  });

  it("detects environment from the key prefix", () => {
    expect(new KeelClient({ apiKey: TEST_KEY }).environment).toBe("sandbox");
    expect(new KeelClient({ apiKey: LIVE_KEY }).environment).toBe("live");
  });

  it("sends the bearer key against the sandbox path", async () => {
    const { fn, calls } = mockFetch(200, { environment: "sandbox", user_id: "u1" });
    const client = new KeelClient({ apiKey: TEST_KEY, baseUrl: "https://example.test", fetch: fn });
    await client.capacity("u1");
    expect(calls[0].url).toBe("https://example.test/api/public/keel/sandbox/v1/users/u1/capacity");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TEST_KEY}`);
  });

  it("posts deposit with converted units and a generated idempotency key", async () => {
    const { fn, calls } = mockFetch(200, { ok: true });
    const client = new KeelClient({ apiKey: TEST_KEY, baseUrl: "https://example.test", fetch: fn });
    await client.deposit("u1", "10");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(calls[0].url).toBe("https://example.test/api/public/keel/sandbox/v1/deposits");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ user_id: "u1", amount: "10000000" });
    expect(headers["Idempotency-Key"]).toMatch(/^[a-f0-9]{48}$/);
  });

  it("uses a caller-supplied idempotency key for safe retries", async () => {
    const { fn, calls } = mockFetch(200, { ok: true });
    const client = new KeelClient({ apiKey: TEST_KEY, baseUrl: "https://example.test", fetch: fn });
    await client.stake("u1", "stake-1", 5, 1.8, { idempotencyKey: "my-retry-key" });
    expect((calls[0].init.headers as Record<string, string>)["Idempotency-Key"]).toBe("my-retry-key");
  });

  it("maps error responses to KeelApiError with code and status", async () => {
    const { fn } = mockFetch(409, { error: { code: "stake_exists" } });
    const client = new KeelClient({ apiKey: TEST_KEY, baseUrl: "https://example.test", fetch: fn });
    const err = await client.exit("u1").catch(e => e);
    expect(err).toBeInstanceOf(KeelApiError);
    expect(err.code).toBe("stake_exists");
    expect(err.status).toBe(409);
  });

  it("targets the live path for live keys", async () => {
    const { fn, calls } = mockFetch(200, { environment: "live", connected: false });
    const client = new KeelClient({ apiKey: LIVE_KEY, baseUrl: "https://example.test", fetch: fn });
    await client.status();
    expect(calls[0].url).toBe("https://example.test/api/public/keel/live/v1/status");
  });
});

describe("verifyWebhookSignature", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ id: "d1", event: "stake.placed", created: "2026-10-22T00:00:00Z", data: {} });
  const now = 1729555200000;

  async function sign(timestamp: number) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
    return Array.from(new Uint8Array(sig), x => x.toString(16).padStart(2, "0")).join("");
  }

  it("accepts a correctly signed fresh delivery", async () => {
    const t = 1729555200;
    const v1 = await sign(t);
    expect(await verifyWebhookSignature({ secret, signatureHeader: `t=${t},v1=${v1}`, body, now })).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const t = 1729555200;
    const v1 = await sign(t);
    expect(await verifyWebhookSignature({ secret, signatureHeader: `t=${t},v1=${v1}`, body: body + " ", now })).toBe(false);
  });

  it("rejects a wrong secret", async () => {
    const t = 1729555200;
    const v1 = await sign(t);
    expect(await verifyWebhookSignature({ secret: "whsec_other", signatureHeader: `t=${t},v1=${v1}`, body, now })).toBe(false);
  });

  it("rejects stale timestamps outside the tolerance window", async () => {
    const t = 1729555200 - 301;
    const v1 = await sign(t);
    expect(await verifyWebhookSignature({ secret, signatureHeader: `t=${t},v1=${v1}`, body, now })).toBe(false);
  });

  it("rejects malformed signature headers", async () => {
    expect(await verifyWebhookSignature({ secret, signatureHeader: "v1=abc", body, now })).toBe(false);
    expect(await verifyWebhookSignature({ secret, signatureHeader: "t=abc,v1=def", body, now })).toBe(false);
  });

  it("rejects non-finite tolerance and clock options", async () => {
    const t = 1729555200;
    const v1 = await sign(t);
    expect(await verifyWebhookSignature({ secret, signatureHeader: `t=${t},v1=${v1}`, body, now, toleranceSeconds: NaN })).toBe(false);
    expect(await verifyWebhookSignature({ secret, signatureHeader: `t=${t},v1=${v1}`, body, now, toleranceSeconds: Infinity })).toBe(false);
    expect(await verifyWebhookSignature({ secret, signatureHeader: `t=${t},v1=${v1}`, body, now, toleranceSeconds: -1 })).toBe(false);
    expect(await verifyWebhookSignature({ secret, signatureHeader: `t=${t},v1=${v1}`, body, now: NaN })).toBe(false);
  });
});

import { keelFeeShare } from "./index";
describe("keelFeeShare", () => {
  it("shares play and deposit fees at the agreed rate, rounded down", () => {
    expect(keelFeeShare("play", "1000000", 2000)).toBe("200000");
    expect(keelFeeShare("deposit", "999", 2000)).toBe("199");
  });
  it("never shares exit fees", () => expect(keelFeeShare("exit", "1000000", 2000)).toBe("0"));
});
