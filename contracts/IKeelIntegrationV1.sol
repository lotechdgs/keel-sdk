// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Keel company integration discovery and evidence interface, draft v1.
/// @dev Interface only: NOT a fund-handling implementation or security audit.
interface IKeelIntegrationV1 {
    /// @dev Must return 1. Getters must be stable and readable at historical blocks.
    function keelIntegrationVersion() external view returns (uint256);
    /// @dev keccak256(bytes(lowercase canonical Keel company UUID)).
    function keelCompanyId() external view returns (bytes32);
    function keelAsset() external view returns (address);
    function keelTreasury() external view returns (address);
    function keelFeeRecipient() external view returns (address);
    /// @dev Opaque binding to an immutable Keel agreement, supplied during onboarding.
    function keelAgreementId() external view returns (bytes32);
    /// @dev Share of eligible collected play fees in basis points, NOT stake/deposit rate.
    function keelFeeShareBps() external view returns (uint256);

    // Evidence is emitted only after the corresponding funded action succeeds.
    // IDs are opaque, tenant-scoped and unique; never emit personal information.
    event KeelFundingConfirmed(bytes32 indexed operationId, bytes32 indexed userId,
        address indexed asset, uint256 amount);
    event KeelStakeConfirmed(bytes32 indexed operationId, bytes32 indexed userId,
        bytes32 indexed stakeId, uint256 fromPlay, uint256 fromWallet, uint256 playFee);
    // result: 0 = lost, 1 = won, 2 = void. Returned stake is not net profit.
    event KeelSettlementConfirmed(bytes32 indexed operationId, bytes32 indexed userId,
        bytes32 indexed stakeId, uint8 result, uint256 walletReturn, uint256 netProfit);
    event KeelFeeCollected(bytes32 indexed operationId, bytes32 indexed agreementId,
        address indexed asset, uint256 eligiblePlayFee, uint256 keelShare,
        address recipient);
    // Keel's agreed share of an activated deposit fee. Exit fees are company-only: never emit a Keel fee for them.
    event KeelDepositFeeCollected(bytes32 indexed operationId, bytes32 indexed agreementId,
        address indexed asset, uint256 eligibleDepositFee, uint256 keelShare,
        address recipient);
    event KeelFeeReversed(bytes32 indexed operationId, bytes32 indexed originalOperationId,
        bytes32 indexed agreementId, uint256 eligiblePlayFee, uint256 keelShare);
    event KeelExitConfirmed(bytes32 indexed operationId, bytes32 indexed userId,
        address indexed recipient, address asset, uint256 amount);
}