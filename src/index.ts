/**
 * Keel partner API client.
 *
 * Wraps the sandbox (/api/public/keel/sandbox/v1) and live
 * (/api/public/keel/live/v1) tiers. Amounts are six-decimal fixed-point
 * integer strings ("1500000" = 1.5 credits); use toUnits/fromUnits to convert.
 * Money commands are idempotent: every POST carries an Idempotency-Key header.
 * A key is generated per call unless you supply one — for safe retries of a
 * failed call, pass the same durable key you used the first time.
 */

export type KeelEnvironment = "sandbox" | "live";
/** Integration metadata only; both use the same sandbox API and TEST credits. */
export type KeelIntegrationType = "web2" | "evm" | "solana";
export interface KeelWeb2Integration {
  type: "web2";
  settlementSystem: "offchain";
  /** Company ledger unit, e.g. USD, NGN or CREDITS; not the sandbox asset. */
  currency: string;
  /** Ledger precision; the sandbox API always uses six decimal places. */
  ledgerDecimals: number;
}

/** Stable platform account ID, not a wallet address; no blockchain dependency. */
export function accountUserId(accountId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(accountId)) throw new Error("Account ID must contain 1–64 letters, digits, underscores or hyphens");
  return accountId;
}

export interface KeelClientOptions {
  /** keel_test_… or keel_live_… key issued from the Keel owner console. */
  apiKey: string;
  /** Base URL of the Keel app. Defaults to the hosted preview. */
  baseUrl?: string;
  /** Inject a fetch implementation (tests, edge runtimes). */
  fetch?: typeof fetch;
}

export class KeelApiError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
    this.name = "KeelApiError";
  }
}

/** Balance/capacity snapshot returned by every endpoint. */
export interface KeelCapacity {
  profit_protection_enabled: boolean;
  profit_protection_percentage: number;
  environment: KeelEnvironment;
  asset: string;
  decimals: number;
  user_id: string;
  wallet: string;
  protected: string;
  play_balance: string;
  fee_pending: string;
  used: string;
  can_exit: boolean;
  exit_amount: string;
}

export interface KeelDepositResult extends KeelCapacity {
  deposit_fee: string;
  amount_protected: string;
  /** Keel's agreed share of `deposit_fee` (integer units). */
  keel_fee_share: string;
}

export interface KeelStakeResult extends KeelCapacity {
  stake_id: string;
  from_play: string;
  from_wallet: string;
  play_fee: string;
  /** Keel's agreed share of `play_fee` (integer units). */
  keel_fee_share: string;
  agreement_version: number;
}

export interface KeelSettleResult extends KeelCapacity {
  profit_protected: string;
  stake_id: string;
  result: "won" | "lost" | "void";
}

export interface KeelExitResult extends KeelCapacity {
  total_protected: string;
  amount_used: string;
  exit_fee: string;
  /** Always "0": exit fees belong entirely to the company. */
  keel_fee_share: "0";
  payout: string;
}

export interface KeelLiveStatus {
  environment: "live";
  connected: boolean;
  state?: "blocked" | "suspended" | "ready";
  missing?: string[];
  checkedAt?: string | null;
  bindingVersion?: number | null;
}

export interface CallOptions {
  /** Supply your own idempotency key to safely retry a specific command. */
  idempotencyKey?: string;
}

export interface KeelProfitProtection { enabled: boolean; percentage: number }
export interface KeelProfitResult extends KeelCapacity {
  profit_id: string;
  service: string;
  profit: string;
  profit_protected: string;
  profit_deposit_fee: string;
  /** Keel's agreed share of `profit_deposit_fee` (integer units). */
  keel_fee_share: string;
  profit_protection_status: string;
}

/** Fee kinds Keel shares in. Exit fees are never shared and have no Keel share. */
export type KeelSharedFeeKind = "play" | "deposit";
/**
 * Keel's share of a collected fee under the agreed basis-point rate, rounded down.
 * Exit fees always return "0". Matches the amount Keel verifies in Live fee receipts.
 */
export function keelFeeShare(kind: KeelSharedFeeKind | "exit", feeUnits: string, rateBps: number): string {
  if (!/^\d+$/.test(feeUnits)) throw new Error("Fee must be an integer unit string");
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10000) throw new Error("rateBps must be an integer from 0 to 10000");
  if (kind === "exit") return "0";
  return (BigInt(feeUnits) * BigInt(rateBps) / 10000n).toString();
}

const DEFAULT_BASE_URL = "https://keelprotect.xyz";

/** Convert a decimal amount ("1.5" or 1.5) to a six-decimal unit string. */
export function toUnits(amount: string | number): string {
  const text = String(amount);
  if (!/^\d+(\.\d{1,6})?$/.test(text)) throw new Error("Amount must be a non-negative decimal with at most 6 decimal places");
  const [whole, frac = ""] = text.split(".");
  const units = BigInt(whole) * 1000000n + BigInt((frac + "000000").slice(0, 6));
  if (units <= 0n) throw new Error("Amount must be greater than zero");
  return units.toString();
}

/** Convert a six-decimal unit string to a plain decimal string. */
export function fromUnits(units: string): string {
  if (!/^\d+$/.test(units)) throw new Error("Units must be a non-negative integer string");
  const value = BigInt(units);
  const whole = value / 1000000n;
  const frac = (value % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

function randomKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

export class KeelClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly doFetch: typeof fetch;

  constructor(options: KeelClientOptions) {
    if (!/^keel_(test|live)_[a-f0-9]{64}$/.test(options.apiKey)) {
      throw new Error("apiKey must be a keel_test_… or keel_live_… key");
    }
    this.environment = options.apiKey.startsWith("keel_live_") ? "live" : "sandbox";
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.doFetch = options.fetch ?? fetch;
  }

  readonly environment: KeelEnvironment;

  private get url(): string {
    return `${this.baseUrl}/api/public/keel/${this.environment}/v1`;
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, key?: string): Promise<T> {
    const res = await this.doFetch(`${this.url}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(method === "POST" ? { "Content-Type": "application/json", "Idempotency-Key": key ?? randomKey() } : {}),
      },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });
    const data = (await res.json().catch(() => null)) as ({ error?: { code?: string } } & T) | null;
    if (!res.ok) throw new KeelApiError(data?.error?.code ?? "request_failed", res.status);
    if (!data) throw new KeelApiError("invalid_response", res.status);
    return data;
  }

  /** Live tier only: connection status. */
  status(): Promise<KeelLiveStatus> {
    return this.request<KeelLiveStatus>("GET", "status");
  }

  /** Current balances and playable capacity for an end user. */
  capacity(userId: string): Promise<KeelCapacity> {
    return this.request<KeelCapacity>("GET", `users/${encodeURIComponent(accountUserId(userId))}/capacity`);
  }

  /** Protect funds for a user. Amount is a decimal string/number of credits. */
  deposit(userId: string, amount: string | number, opts?: CallOptions): Promise<KeelDepositResult> {
    return this.request<KeelDepositResult>("POST", "deposits", { user_id: accountUserId(userId), amount: toUnits(amount) }, opts?.idempotencyKey);
  }

  /** Credit a user's demo wallet without opening capacity. */
  creditWallet(userId: string, amount: string | number, opts?: CallOptions): Promise<KeelCapacity> {
    return this.request<KeelCapacity>("POST", "wallet", { user_id: accountUserId(userId), amount: toUnits(amount) }, opts?.idempotencyKey);
  }

  /** Place a stake. Uses play balance first, wallet tops up the rest. */
  stake(userId: string, stakeId: string, amount: string | number, payoutMultiplier = 1.8, opts?: CallOptions): Promise<KeelStakeResult> {
    return this.request<KeelStakeResult>("POST", "stakes", { user_id: accountUserId(userId), stake_id: accountUserId(stakeId), amount: toUnits(amount), payout_multiplier: payoutMultiplier }, opts?.idempotencyKey);
  }

  /** Settle an open stake as won, lost or void. */
  settle(userId: string, stakeId: string, result: "won" | "lost" | "void", opts?: CallOptions): Promise<KeelSettleResult> {
    return this.request<KeelSettleResult>("POST", `stakes/${encodeURIComponent(accountUserId(stakeId))}/settle`, { user_id: accountUserId(userId), result }, opts?.idempotencyKey);
  }

  /** Persist a user's explicit opt-in/out and share of future settled net profit. */
  setProfitProtection(userId: string, preference: KeelProfitProtection, opts?: CallOptions): Promise<KeelCapacity> {
    if (typeof preference.enabled !== "boolean" || !Number.isFinite(preference.percentage) || preference.percentage < 5 || preference.percentage > 100) throw new Error("Profit protection percentage must be 5–100");
    return this.request<KeelCapacity>("POST", "profit-settings", { user_id: accountUserId(userId), preference }, opts?.idempotencyKey);
  }

  /** Sandbox-only: simulate a settled net profit from any platform service. Never a Live funding proof. */
  creditProfit(userId: string, profitId: string, service: string, profit: string | number, opts?: CallOptions): Promise<KeelProfitResult> {
    if (this.environment !== "sandbox") throw new KeelApiError("operation_not_allowed", 403);
    return this.request<KeelProfitResult>("POST", "profits", { user_id: accountUserId(userId), profit_id: accountUserId(profitId), service: accountUserId(service), amount: toUnits(profit) }, opts?.idempotencyKey);
  }

  /** Exit: return remaining protected funds to the user's wallet. */
  exit(userId: string, opts?: CallOptions): Promise<KeelExitResult> {
    return this.request<KeelExitResult>("POST", "exits", { user_id: accountUserId(userId) }, opts?.idempotencyKey);
  }
}

export interface WebhookVerificationInput {
  /** Webhook secret shown once in the owner console. */
  secret: string;
  /** Raw Keel-Signature header, e.g. "t=1729555200,v1=ab12…". */
  signatureHeader: string;
  /** Exact raw request body string. */
  body: string;
  /** Reject events older than this many seconds. Defaults to 300. */
  toleranceSeconds?: number;
  now?: number;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), x => x.toString(16).padStart(2, "0")).join("");
}

/** Verify a Keel webhook delivery. Returns true only for a fresh, correctly signed body. */
export async function verifyWebhookSignature(input: WebhookVerificationInput): Promise<boolean> {
  const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(input.signatureHeader.trim());
  if (!match) return false;
  const timestamp = Number(match[1]);
  const tolerance = input.toleranceSeconds ?? 300;
  const at = input.now ?? Date.now();
  if (!Number.isFinite(tolerance) || tolerance < 0 || !Number.isFinite(at)) return false;
  const now = Math.floor(at / 1000);
  if (Math.abs(now - timestamp) > tolerance) return false;
  const expected = await hmacHex(input.secret, `${timestamp}.${input.body}`);
  return expected === match[2];
}
