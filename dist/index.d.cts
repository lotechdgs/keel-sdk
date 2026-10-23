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
type KeelEnvironment = "sandbox" | "live";
/** Integration metadata only; both use the same sandbox API and TEST credits. */
type KeelIntegrationType = "web2" | "evm" | "solana";
interface KeelWeb2Integration {
    type: "web2";
    settlementSystem: "offchain";
    /** Company ledger unit, e.g. USD, NGN or CREDITS; not the sandbox asset. */
    currency: string;
    /** Ledger precision; the sandbox API always uses six decimal places. */
    ledgerDecimals: number;
}
/** Stable platform account ID, not a wallet address; no blockchain dependency. */
declare function accountUserId(accountId: string): string;
interface KeelClientOptions {
    /** keel_test_… or keel_live_… key issued from the Keel owner console. */
    apiKey: string;
    /** Base URL of the Keel app. Defaults to the hosted preview. */
    baseUrl?: string;
    /** Inject a fetch implementation (tests, edge runtimes). */
    fetch?: typeof fetch;
}
declare class KeelApiError extends Error {
    code: string;
    status: number;
    constructor(code: string, status: number);
}
/** Balance/capacity snapshot returned by every endpoint. */
interface KeelCapacity {
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
interface KeelDepositResult extends KeelCapacity {
    deposit_fee: string;
    amount_protected: string;
    /** Keel's agreed share of `deposit_fee` (integer units). */
    keel_fee_share: string;
}
interface KeelStakeResult extends KeelCapacity {
    stake_id: string;
    from_play: string;
    from_wallet: string;
    play_fee: string;
    /** Keel's agreed share of `play_fee` (integer units). */
    keel_fee_share: string;
    agreement_version: number;
}
interface KeelSettleResult extends KeelCapacity {
    profit_protected: string;
    stake_id: string;
    result: "won" | "lost" | "void";
}
interface KeelExitResult extends KeelCapacity {
    total_protected: string;
    amount_used: string;
    exit_fee: string;
    /** Always "0": exit fees belong entirely to the company. */
    keel_fee_share: "0";
    payout: string;
}
interface KeelLiveStatus {
    environment: "live";
    connected: boolean;
    state?: "blocked" | "suspended" | "ready";
    missing?: string[];
    checkedAt?: string | null;
    bindingVersion?: number | null;
}
interface CallOptions {
    /** Supply your own idempotency key to safely retry a specific command. */
    idempotencyKey?: string;
}
interface KeelProfitProtection {
    enabled: boolean;
    percentage: number;
}
interface KeelProfitResult extends KeelCapacity {
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
type KeelSharedFeeKind = "play" | "deposit";
/**
 * Keel's share of a collected fee under the agreed basis-point rate, rounded down.
 * Exit fees always return "0". Matches the amount Keel verifies in Live fee receipts.
 */
declare function keelFeeShare(kind: KeelSharedFeeKind | "exit", feeUnits: string, rateBps: number): string;
/** Convert a decimal amount ("1.5" or 1.5) to a six-decimal unit string. */
declare function toUnits(amount: string | number): string;
/** Convert a six-decimal unit string to a plain decimal string. */
declare function fromUnits(units: string): string;
declare class KeelClient {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly doFetch;
    constructor(options: KeelClientOptions);
    readonly environment: KeelEnvironment;
    private get url();
    private request;
    /** Live tier only: connection status. */
    status(): Promise<KeelLiveStatus>;
    /** Current balances and playable capacity for an end user. */
    capacity(userId: string): Promise<KeelCapacity>;
    /** Protect funds for a user. Amount is a decimal string/number of credits. */
    deposit(userId: string, amount: string | number, opts?: CallOptions): Promise<KeelDepositResult>;
    /** Credit a user's demo wallet without opening capacity. */
    creditWallet(userId: string, amount: string | number, opts?: CallOptions): Promise<KeelCapacity>;
    /** Place a stake. Uses play balance first, wallet tops up the rest. */
    stake(userId: string, stakeId: string, amount: string | number, payoutMultiplier?: number, opts?: CallOptions): Promise<KeelStakeResult>;
    /** Settle an open stake as won, lost or void. */
    settle(userId: string, stakeId: string, result: "won" | "lost" | "void", opts?: CallOptions): Promise<KeelSettleResult>;
    /** Persist a user's explicit opt-in/out and share of future settled net profit. */
    setProfitProtection(userId: string, preference: KeelProfitProtection, opts?: CallOptions): Promise<KeelCapacity>;
    /** Sandbox-only: simulate a settled net profit from any platform service. Never a Live funding proof. */
    creditProfit(userId: string, profitId: string, service: string, profit: string | number, opts?: CallOptions): Promise<KeelProfitResult>;
    /** Exit: return remaining protected funds to the user's wallet. */
    exit(userId: string, opts?: CallOptions): Promise<KeelExitResult>;
}
interface WebhookVerificationInput {
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
/** Verify a Keel webhook delivery. Returns true only for a fresh, correctly signed body. */
declare function verifyWebhookSignature(input: WebhookVerificationInput): Promise<boolean>;

export { type CallOptions, KeelApiError, type KeelCapacity, KeelClient, type KeelClientOptions, type KeelDepositResult, type KeelEnvironment, type KeelExitResult, type KeelIntegrationType, type KeelLiveStatus, type KeelProfitProtection, type KeelProfitResult, type KeelSettleResult, type KeelSharedFeeKind, type KeelStakeResult, type KeelWeb2Integration, type WebhookVerificationInput, accountUserId, fromUnits, keelFeeShare, toUnits, verifyWebhookSignature };
