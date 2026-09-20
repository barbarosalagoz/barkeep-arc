// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {Tab} from "../src/Tab.sol";
import {Base} from "./utils/Base.sol";

contract TabCloseTest is Base {
    function test_only_the_owner_closes() public {
        vm.prank(agent);
        vm.expectRevert(Tab.NotOwner.selector);
        tab.close();

        vm.prank(stranger);
        vm.expectRevert(Tab.NotOwner.selector);
        tab.close();

        assertFalse(tab.closed());
        assertEq(USDC.balanceOf(address(tab)), CAP);
    }

    function test_close_returns_everything_left_to_the_owner() public {
        Auth memory a = _auth(payeeA, 400_000);
        _settle(tab, a, _sign(agentKey, tab, a));

        uint256 before = USDC.balanceOf(owner);
        vm.expectEmit(true, false, false, true, address(tab));
        emit Tab.Closed(owner, CAP - 400_000, true);
        vm.prank(owner);
        tab.close();

        assertTrue(tab.closed());
        assertEq(USDC.balanceOf(address(tab)), 0);
        assertEq(USDC.balanceOf(owner), before + CAP - 400_000);
    }

    function test_after_close_the_agent_key_is_useless() public {
        Auth memory a = _auth(payeeA, 1);
        bytes memory sig = _sign(agentKey, tab, a);

        vm.prank(owner);
        tab.close();

        assertEq(tab.isValidSignature(_transferDigest(address(tab), a), sig), REFUSED);
        _expectRefusedOnChain(tab, a, sig);
    }

    /// Closed means closed: money arriving afterwards does not bring the agent back.
    function test_refunding_a_closed_tab_does_not_reopen_it() public {
        vm.prank(owner);
        tab.close();

        vm.prank(stranger);
        USDC.transfer(address(tab), 5e6);

        Auth memory a = _auth(payeeA, 1);
        _expectRefusedOnChain(tab, a, _sign(agentKey, tab, a));

        // The owner can still collect it.
        uint256 before = USDC.balanceOf(owner);
        vm.prank(owner);
        tab.close();
        assertEq(USDC.balanceOf(owner), before + 5e6);
        assertEq(USDC.balanceOf(address(tab)), 0);
    }

    function test_closing_an_empty_tab_is_fine() public {
        vm.startPrank(owner);
        tab.close();
        tab.close();
        vm.stopPrank();
        assertTrue(tab.closed());
    }

    function test_the_owner_can_close_after_expiry() public {
        vm.warp(uint256(expiry) + 365 days);
        uint256 before = USDC.balanceOf(owner);
        vm.prank(owner);
        tab.close();
        assertEq(USDC.balanceOf(owner), before + CAP);
    }

    /// Revocation must not depend on the money moving: a blocklisted owner contract, or a paused USDC, would
    /// otherwise leave the agent live until expiry.
    function test_close_revokes_the_agent_even_when_usdc_refuses_the_sweep() public {
        vm.mockCallRevert(
            address(USDC), abi.encodeWithSelector(USDC.transfer.selector), "Blacklistable: account is blacklisted"
        );
        vm.expectEmit(true, false, false, true, address(tab));
        emit Tab.Closed(owner, CAP, false);
        vm.prank(owner);
        tab.close();
        vm.clearMockedCalls();

        assertTrue(tab.closed());
        assertEq(USDC.balanceOf(address(tab)), CAP);
        Auth memory a = _auth(payeeA, 1);
        _expectRefusedOnChain(tab, a, _sign(agentKey, tab, a));

        // Once USDC lets the transfer through, the same call collects.
        uint256 before = USDC.balanceOf(owner);
        vm.prank(owner);
        tab.close();
        assertEq(USDC.balanceOf(owner), before + CAP);
    }

    /// Real USDC reverts rather than returns false; a token that returned false is treated the same way.
    function test_a_false_return_from_usdc_still_closes_and_reports_not_swept() public {
        vm.mockCall(address(USDC), abi.encodeWithSelector(USDC.transfer.selector), abi.encode(false));
        vm.expectEmit(true, false, false, true, address(tab));
        emit Tab.Closed(owner, CAP, false);
        vm.prank(owner);
        tab.close();
        vm.clearMockedCalls();

        assertTrue(tab.closed());
        assertEq(USDC.balanceOf(address(tab)), CAP);
    }
}
