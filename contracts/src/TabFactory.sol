// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

import {IUSDC} from "./IUSDC.sol";
import {MAX_PAYEES, Tab} from "./Tab.sol";

/*
 * Opens tabs. Each one is an EIP-1167 clone of one Tab implementation, created
 * with CREATE2 and carrying its terms as immutable arguments, so its address
 * follows from the terms, the caller and a salt, and can be known beforehand.
 *
 * The factory has no owner, no admin, no storage and no way to touch a tab
 * after opening it. It never holds funds: the cap goes from the caller straight
 * to the new tab in the same transaction.
 *
 * Unaudited.
 */
contract TabFactory {
    IUSDC public constant USDC = IUSDC(0x3600000000000000000000000000000000000000);

    address public immutable IMPLEMENTATION;

    event TabOpened(
        address indexed tab,
        address indexed owner,
        address indexed agent,
        uint256 cap,
        uint256 maxPerCall,
        uint64 expiry,
        address[] payees
    );

    error ZeroAgent();
    error ZeroPayee();
    error BadPayeeCount();
    error ZeroCap();
    error ZeroMaxPerCall();
    error MaxPerCallAboveCap();
    error ExpiryNotInFuture();
    error FundingFailed();

    constructor() {
        IMPLEMENTATION = address(new Tab());
    }

    /**
     * Opens a tab owned by the caller and funds it with `cap` of the caller's
     * USDC, which the caller must have approved to this factory. The owner is
     * always the caller and is part of the clone's bytecode, so the address
     * depends on who opens the tab and nobody else can take it first.
     */
    function openTab(
        address agent,
        address[] calldata payees,
        uint256 maxPerCall,
        uint64 expiry,
        uint256 cap,
        bytes32 salt
    ) external returns (address tab) {
        if (agent == address(0)) revert ZeroAgent();
        if (payees.length == 0 || payees.length > MAX_PAYEES) revert BadPayeeCount();
        for (uint256 i = 0; i < payees.length; ++i) {
            if (payees[i] == address(0)) revert ZeroPayee();
        }
        if (cap == 0) revert ZeroCap();
        if (maxPerCall == 0) revert ZeroMaxPerCall();
        if (maxPerCall > cap) revert MaxPerCallAboveCap();
        if (expiry <= block.timestamp) revert ExpiryNotInFuture();

        tab = Clones.cloneDeterministicWithImmutableArgs(
            IMPLEMENTATION, _terms(msg.sender, agent, payees, maxPerCall, expiry), salt
        );

        emit TabOpened(tab, msg.sender, agent, cap, maxPerCall, expiry, payees);
        if (!USDC.transferFrom(msg.sender, tab, cap)) revert FundingFailed();
    }

    /// The address openTab would give, for the same caller and arguments.
    function predictTab(
        address owner,
        address agent,
        address[] calldata payees,
        uint256 maxPerCall,
        uint64 expiry,
        bytes32 salt
    ) external view returns (address) {
        return Clones.predictDeterministicAddressWithImmutableArgs(
            IMPLEMENTATION, _terms(owner, agent, payees, maxPerCall, expiry), salt
        );
    }

    function _terms(address owner, address agent, address[] calldata payees, uint256 maxPerCall, uint64 expiry)
        private
        pure
        returns (bytes memory)
    {
        return abi.encode(
            Tab.Terms({owner: owner, agent: agent, maxPerCall: maxPerCall, expiry: expiry, payees: payees})
        );
    }
}
