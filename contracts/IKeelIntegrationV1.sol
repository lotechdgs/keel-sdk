// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IKeelIntegrationV1
/// @notice Reference interface for client contracts routing play/deposit activity through Keel.
interface IKeelIntegrationV1 {
    /// @notice Address designated by Keel to receive agreed platform fee shares.
    /// @dev Keel fee share applies to play fees and active deposit fees (never exit fees).
    ///      Under-payments are credited as received and flagged as incomplete/shortfall.
    function keelFeeRecipient() external view returns (address);

    /// @notice Returns whether Keel protection is active for this deployment.
    function keelProtectionActive() external view returns (bool);
}
