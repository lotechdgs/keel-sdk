"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  KeelApiError: () => KeelApiError,
  KeelClient: () => KeelClient,
  accountUserId: () => accountUserId,
  fromUnits: () => fromUnits,
  keelFeeShare: () => keelFeeShare,
  toUnits: () => toUnits,
  verifyWebhookSignature: () => verifyWebhookSignature
});
module.exports = __toCommonJS(index_exports);
function accountUserId(accountId) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(accountId)) throw new Error("Account ID must contain 1\u201364 letters, digits, underscores or hyphens");
  return accountId;
}
var KeelApiError = class extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = "KeelApiError";
  }
};
function keelFeeShare(kind, feeUnits, rateBps) {
  if (!/^\d+$/.test(feeUnits)) throw new Error("Fee must be an integer unit string");
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 1e4) throw new Error("rateBps must be an integer from 0 to 10000");
  if (kind === "exit") return "0";
  return (BigInt(feeUnits) * BigInt(rateBps) / 10000n).toString();
}
var DEFAULT_BASE_URL = "https://keelprotect.xyz";
function toUnits(amount) {
  const text = String(amount);
  if (!/^\d+(\.\d{1,6})?$/.test(text)) throw new Error("Amount must be a non-negative decimal with at most 6 decimal places");
  const [whole, frac = ""] = text.split(".");
  const units = BigInt(whole) * 1000000n + BigInt((frac + "000000").slice(0, 6));
  if (units <= 0n) throw new Error("Amount must be greater than zero");
  return units.toString();
}
function fromUnits(units) {
  if (!/^\d+$/.test(units)) throw new Error("Units must be a non-negative integer string");
  const value = BigInt(units);
  const whole = value / 1000000n;
  const frac = (value % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}
function randomKey() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
var KeelClient = class {
  constructor(options) {
    if (!/^keel_(test|live)_[a-f0-9]{64}$/.test(options.apiKey)) {
      throw new Error("apiKey must be a keel_test_\u2026 or keel_live_\u2026 key");
    }
    this.environment = options.apiKey.startsWith("keel_live_") ? "live" : "sandbox";
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.doFetch = options.fetch ?? fetch;
  }
  get url() {
    return `${this.baseUrl}/api/public/keel/${this.environment}/v1`;
  }
  async request(method, path, body, key) {
    const res = await this.doFetch(`${this.url}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...method === "POST" ? { "Content-Type": "application/json", "Idempotency-Key": key ?? randomKey() } : {}
      },
      body: method === "POST" ? JSON.stringify(body ?? {}) : void 0
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new KeelApiError(data?.error?.code ?? "request_failed", res.status);
    if (!data) throw new KeelApiError("invalid_response", res.status);
    return data;
  }
  /** Live tier only: connection status. */
  status() {
    return this.request("GET", "status");
  }
  /** Current balances and playable capacity for an end user. */
  capacity(userId) {
    return this.request("GET", `users/${encodeURIComponent(accountUserId(userId))}/capacity`);
  }
  /** Protect funds for a user. Amount is a decimal string/number of credits. */
  deposit(userId, amount, opts) {
    return this.request("POST", "deposits", { user_id: accountUserId(userId), amount: toUnits(amount) }, opts?.idempotencyKey);
  }
  /** Credit a user's demo wallet without opening capacity. */
  creditWallet(userId, amount, opts) {
    return this.request("POST", "wallet", { user_id: accountUserId(userId), amount: toUnits(amount) }, opts?.idempotencyKey);
  }
  /** Place a stake. Uses play balance first, wallet tops up the rest. */
  stake(userId, stakeId, amount, payoutMultiplier = 1.8, opts) {
    return this.request("POST", "stakes", { user_id: accountUserId(userId), stake_id: accountUserId(stakeId), amount: toUnits(amount), payout_multiplier: payoutMultiplier }, opts?.idempotencyKey);
  }
  /** Settle an open stake as won, lost or void. */
  settle(userId, stakeId, result, opts) {
    return this.request("POST", `stakes/${encodeURIComponent(accountUserId(stakeId))}/settle`, { user_id: accountUserId(userId), result }, opts?.idempotencyKey);
  }
  /** Persist a user's explicit opt-in/out and share of future settled net profit. */
  setProfitProtection(userId, preference, opts) {
    if (typeof preference.enabled !== "boolean" || !Number.isFinite(preference.percentage) || preference.percentage < 5 || preference.percentage > 100) throw new Error("Profit protection percentage must be 5\u2013100");
    return this.request("POST", "profit-settings", { user_id: accountUserId(userId), preference }, opts?.idempotencyKey);
  }
  /** Sandbox-only: simulate a settled net profit from any platform service. Never a Live funding proof. */
  creditProfit(userId, profitId, service, profit, opts) {
    if (this.environment !== "sandbox") throw new KeelApiError("operation_not_allowed", 403);
    return this.request("POST", "profits", { user_id: accountUserId(userId), profit_id: accountUserId(profitId), service: accountUserId(service), amount: toUnits(profit) }, opts?.idempotencyKey);
  }
  /** Exit: return remaining protected funds to the user's wallet. */
  exit(userId, opts) {
    return this.request("POST", "exits", { user_id: accountUserId(userId) }, opts?.idempotencyKey);
  }
};
async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (x) => x.toString(16).padStart(2, "0")).join("");
}
async function verifyWebhookSignature(input) {
  const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(input.signatureHeader.trim());
  if (!match) return false;
  const timestamp = Number(match[1]);
  const tolerance = input.toleranceSeconds ?? 300;
  const at = input.now ?? Date.now();
  if (!Number.isFinite(tolerance) || tolerance < 0 || !Number.isFinite(at)) return false;
  const now = Math.floor(at / 1e3);
  if (Math.abs(now - timestamp) > tolerance) return false;
  const expected = await hmacHex(input.secret, `${timestamp}.${input.body}`);
  return expected === match[2];
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  KeelApiError,
  KeelClient,
  accountUserId,
  fromUnits,
  keelFeeShare,
  toUnits,
  verifyWebhookSignature
});
