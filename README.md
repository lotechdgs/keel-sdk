# @keelprotect/sdk

TypeScript client for the Keel partner API. One package covers both tiers:

This SDK is optional. Clients can call the documented REST API directly from any server language; the same authentication, amount, idempotency and webhook rules apply.

- **Sandbox** — `/api/public/keel/sandbox/v1`, TEST credits, full money flow for integration testing.
- **Live** — `/api/public/keel/live/v1`, status reports automatic readiness with a valid key; money remains disabled until a working verified connection exists.

Dependency-free. Ships as TypeScript source — use it with a bundler or a TypeScript-capable runtime (Bun, Deno, edge runtimes, or Node with type stripping). Server-side use only — never expose your key to end users.

## Setup

## Web2 and Web3

The same API and SDK support ordinary platform account IDs, not just blockchain users. Web2 sandbox integration needs no wallet connection, contract, token address or chain library. Your company retains custody and owns the interface and account ledger. Select **Web2** in the integration form and record your ledger currency/credit unit, precision, account/payment documentation, administrator controls and signed webhook endpoint.

Sandbox amounts always represent **TEST credits with six decimal places**, regardless of your proposed ledger currency. Recording USD or NGN does not connect bank payments or convert TEST credits into cash. Live Web2 requires a reviewed account-ledger/payment reconciliation connection; it is not implemented and money operations remain disabled.

```ts
import { KeelClient, accountUserId, type KeelWeb2Integration } from "@keelprotect/sdk";

const integration: KeelWeb2Integration = {
  type: "web2", settlementSystem: "offchain", currency: "USD", ledgerDecimals: 2,
}; // Local metadata only; does not configure or activate the API.
const apiKey = process.env.KEEL_API_KEY;
if (!apiKey) throw new Error("Missing Keel API key");
const keel = new KeelClient({ apiKey, baseUrl: "https://keelprotect.xyz" });
const userId = accountUserId("account_42"); // From your authenticated account mapping.
await keel.creditWallet(userId, "25.50", { idempotencyKey: "topup-42" });
await keel.deposit(userId, "100", { idempotencyKey: "protect-42" });
await keel.stake(userId, "order-42", "10", 1.8, { idempotencyKey: "stake-42" });
await keel.settle(userId, "order-42", "void", { idempotencyKey: "void-00042" });
```

Keep keys on your server. Derive `userId` from the signed-in account, never from an unchecked browser input. Use one durable idempotency key per business operation, persist responses, verify/deduplicate webhook events and reconcile before applying any account change. Do not retry ambiguous failures with a new key. Keel is not a bank/card processor and no Live payment, automatic fee collection or conversion is enabled.

```ts
import { KeelClient } from "@keelprotect/sdk";

const keel = new KeelClient({
  apiKey: process.env.KEEL_API_KEY!, // keel_test_… or keel_live_…, from the Keel owner console
  // baseUrl defaults to https://keelprotect.xyz
});
```

The environment is detected from the key prefix (`keel_test_` → sandbox, `keel_live_` → live).

## Usage

```ts
// Protect funds for an end user (amount in decimal credits, converted to units for you)
await keel.deposit("user_123", "1000");

// Read balances and playable capacity
const cap = await keel.capacity("user_123");
// cap.play_balance, cap.fee_pending, cap.used, cap.can_exit, cap.exit_amount — all unit strings

// Place and settle a stake (play balance first, wallet tops up)
await keel.stake("user_123", "bet-001", "50", 1.8);
await keel.settle("user_123", "bet-001", "won"); // or "lost" / "void"

// Exit: return remaining protected funds to the user's wallet
await keel.exit("user_123");
```

### Automatic profit protection

Users opt in to protect 5–100% of future settled **net profit**, not returned stake. Preferences are per user and default off, regardless of wallet/play funding. Net profit subtracts the original stake and charged play fee. Losses/voids/refunds protect nothing. Deposit fees are deducted from the selected share. Minimum and maximum protection default to 0 — no minimum and no limit. A maximum caps the elected share only when set above 0, and pauses or protection-off leave the share in the wallet without blocking settlement.

```ts
await keel.setProfitProtection("user_123", { enabled: true, percentage: 25 },
  { idempotencyKey: "profit-settings-user123-v1" });
// Stake settlement applies the preference automatically.
const settled = await keel.settle("user_123", "bet-001", "won");
// settled.profit_protected: actual net amount protected, in units.

// Sandbox only: simulate finalized net profit from any other service.
const profit = await keel.creditProfit("user_123", "reward-001", "creator_rewards", "100",
  { idempotencyKey: "profit-reward-001" });
```

REST: `POST /profit-settings` accepts `{ user_id, preference: { enabled, percentage } }`; Sandbox-only `POST /profits` accepts `{ user_id, profit_id, service, amount }` (integer units). Snapshots include `profit_protection_enabled` and `profit_protection_percentage`. Profit results include `profit_protected`, `profit_deposit_fee`, `keel_fee_share` and `profit_protection_status`. Same-key retries return the original response; duplicate user/profit IDs under new keys return `profit_exists`. Sandbox permits 500 standalone profit records.

Authenticate users and capture consent server-side. Never credit an activity through both settlement and standalone profit or `/wallet`. Standalone profit is TEST simulation, not verified funding. Live credits are rejected (`operation_not_allowed`); Live settings remain gated until verified earnings/funding, consent, deduplication and reversals are connected.

### Amounts

All API amounts are six-decimal fixed-point integer strings (`"1500000"` = 1.5 credits). The client converts decimal inputs automatically; use `toUnits` / `fromUnits` for your own math.

### Idempotency

Every money command sends an `Idempotency-Key` header, generated per call. Retrying a failed request with the same key returns the original result instead of double-applying:

```ts
await keel.deposit("user_123", "1000", { idempotencyKey: "deposit-order-42" });
// Safe to call again with the same key if the first attempt times out.
```

### Errors

Failures throw `KeelApiError` with the API `code` and HTTP `status`:

```ts
import { KeelApiError } from "@keelprotect/sdk";

try {
  await keel.exit("user_123");
} catch (e) {
  if (e instanceof KeelApiError && e.code === "exit_unavailable") {
    // User has used all protected funds.
  }
}
```

Common codes: `unauthorized` (bad/revoked key), `rate_limited` (retry after 60s), `stake_exists` / `stake_not_found` / `stake_already_settled`, `insufficient_protected_funds`, `exit_unavailable`, `agreement_pending` (live: agreement not yet signed), `live_not_connected` (live: vault not yet verified).

## Webhooks

Keel signs every delivery with HMAC-SHA256. Verify before trusting the payload:

```ts
import { verifyWebhookSignature } from "@keelprotect/sdk";

const ok = await verifyWebhookSignature({
  secret: process.env.KEEL_WEBHOOK_SECRET!, // shown once in the owner console
  signatureHeader: request.headers.get("Keel-Signature")!, // "t=…,v1=…"
  body: rawBody, // exact raw request body string
});
```

Events: `deposit.completed`, `wallet.credited`, `stake.placed`, `stake.settled`, `exit.completed`, `profit_settings.updated`, `profit.credited`. Events are queued atomically with accepted operations. Failed deliveries become eligible for retry after 1m, 5m, 15m and 1h and are marked failed after five attempts. Interrupted claims expire after one minute. Independent retries require configuring the authenticated external retry callback; without it, subsequent sandbox writes or owner tests process due events. Payloads carry API response data only.

## Status

The sandbox tier is fully functional against isolated TEST credits. The live tier authenticates keys and reports status, but money operations return `live_not_connected` until the client vault integration ships.

## Company contract specification — draft v1

`contracts/IKeelIntegrationV1.sol` contains the draft company-owned discovery/evidence interface. Companies implement, review and deploy their own fund-handling contracts; this file is not a deployable implementation or audit. Initial discovery targets Base Sepolia (84532) only. Keel's owner Integration screen can check saved deployed addresses and declarations at one finalized block, without activating Live or modifying Demo/Sandbox.

The shared owner/company implementation guide documents getters, company binding, asset precision, evidence events and remaining requirements. Nonzero recipient/agreement declarations do not verify signed terms or collection. Immutable connection drafts are recorded but not approved; funded commands, money accounting, finality/reversal reconciliation and tested recovery remain incomplete. A company test deployment and independent review are needed to verify them. No new Live SDK money methods are advertised as working. Status derives automatically without manual activation; working money readiness remains the target.

Keel has an internal deterministic agreement commitment helper and Base Sepolia finalized receipt proof verifier. They are not SDK methods or partner endpoints. Prepared receipt acceptance now reserves event/transfer evidence IDs and queues a notification atomically, but does not apply money or allocate paid billing. Funded command accounting, approved review ingestion and reconciliation are still required. Existing Live SDK money calls remain disabled.

`status()` now optionally includes `state`, `missing`, `checkedAt` and `bindingVersion`, without requiring manual activation. Keel stores immutable connection drafts and can internally commit prepared receipt evidence, replay protection and a queued notification atomically. These receipt-only results do not apply balances or paid billing. No partner command-preparation/confirmation method is enabled yet. Sandbox SDK amount conversion remains six decimals; do not reuse it for future Live assets with other precision.

## Keel fee share

Keel's agreed share applies to play fees and activated deposit fees only; exit fees are 100% the company's. Deposit, stake and profit results include `keel_fee_share`; exit results return `"0"`. Use `keelFeeShare("play" | "deposit" | "exit", feeUnits, rateBps)` to compute the exact amount Live verifies. The **entire play fee**, including client and Keel shares, remains pending at placement. Only won/lost settlement earns it; void/refund discards it without transfers to either collection address.

For supported Web3 Live, **automatic remittance is mandatory**: the authorized settlement transaction must split the earned fee and send Keel's exact agreed share to its approved designated address. Optional manual transfers or an independently emitted fee event are not a compliant integration. `KeelFeeCollected` must share its operation ID and transaction with the authorized `KeelSettlementConfirmed` result (0 = lost, 1 = won); the internal verifier checks that settlement against the saved server expectation, and durable validation prevents a second fee for the same user/stake. Received underpayments remain incomplete with the exact shortfall; they never count as full payment.

These checks do **not** implement automatic fund transfers. The SDK forwards API calls and the Solidity file is only an interface; Live money remains disabled until company-owned settlement routing and the funded adapter are independently verified. Web2 keeps settlement-only earnings with verified periodic invoicing, not automatic bank debits.
