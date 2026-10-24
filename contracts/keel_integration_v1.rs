// SPDX-License-Identifier: MIT
//! Keel company integration discovery interface for Solana, draft v1.
//! Interface only: NOT a fund-handling implementation or security audit.
//!
//! The company program must own ONE config account at the PDA
//! `find_program_address(&[b"keel-config"], &program_id)`, with this exact
//! little-endian layout (171 bytes). Keel reads it to detect the integration.
//!
//! Anchor users: `#[account] pub struct KeelConfigV1 { .. }` produces the same
//! discriminator (sha256("account:KeelConfigV1")[..8]) and Borsh layout.

pub const KEEL_CONFIG_SEED: &[u8] = b"keel-config";
pub const KEEL_CONFIG_SIZE: usize = 171;

#[repr(C)]
pub struct KeelConfigV1 {
    /// Must be 1.
    pub version: u8,
    /// keccak256(lowercase canonical Keel company UUID).
    pub company_id: [u8; 32],
    /// SPL token mint used for protection.
    pub asset: [u8; 32],
    /// Company treasury wallet.
    pub treasury: [u8; 32],
    /// Keel's approved fee wallet. Must equal the address Keel gives you.
    pub keel_fee_recipient: [u8; 32],
    /// Opaque binding to the immutable Keel agreement supplied during onboarding.
    pub agreement_id: [u8; 32],
    /// Keel's share of eligible play and activated deposit fees, basis points. Never exit fees.
    pub keel_fee_share_bps: u16,
}

// Required settlement behavior (same rules as IKeelIntegrationV1.sol):
// - Play fees stay pending at placement; neither share is collected or sent.
// - Only a won/lost settlement earns the play fee. In that same instruction the
//   program must automatically transfer Keel's share, floor(fee * bps / 10000),
//   to the associated token account of `keel_fee_recipient` for `asset`.
// - Void discards the entire pending fee; transfer neither share.
// - Settle each stake once. Under-transfers already received are kept and
//   flagged incomplete; they are not compliant routing.
// - Exit fees belong entirely to the company.
// This file specifies layout and behavior; it cannot implement or enforce transfers.
