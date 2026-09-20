// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {Base} from "./utils/Base.sol";

contract TabAcceptTest is Base {
    function test_agent_pays_a_payee_within_the_maximum() public {
        Auth memory a = _auth(payeeA, 250_000);
        bytes memory sig = _sign(agentKey, tab, a);

        assertEq(tab.isValidSignature(_transferDigest(address(tab), a), sig), MAGIC);
        _settle(tab, a, sig);

        assertEq(USDC.balanceOf(payeeA), 250_000);
        assertEq(USDC.balanceOf(address(tab)), CAP - 250_000);
        assertEq(tab.balance(), CAP - 250_000);
    }

    function test_agent_pays_exactly_the_maximum() public {
        Auth memory a = _auth(payeeA, MAX_PER_CALL);
        _settle(tab, a, _sign(agentKey, tab, a));
        assertEq(USDC.balanceOf(payeeA), MAX_PER_CALL);
    }

    function test_agent_pays_the_second_payee() public {
        Auth memory a = _auth(payeeB, 1);
        _settle(tab, a, _sign(agentKey, tab, a));
        assertEq(USDC.balanceOf(payeeB), 1);
    }

    function test_an_authorization_may_run_right_up_to_the_expiry() public {
        Auth memory a = _auth(payeeA, 1);
        a.validBefore = expiry;
        vm.warp(expiry - 1);
        _settle(tab, a, _sign(agentKey, tab, a));
        assertEq(USDC.balanceOf(payeeA), 1);
    }

    function test_the_tab_still_answers_yes_in_its_last_second() public {
        Auth memory a = _auth(payeeA, 1);
        bytes memory sig = _sign(agentKey, tab, a);
        vm.warp(expiry);
        assertEq(tab.isValidSignature(_transferDigest(address(tab), a), sig), MAGIC);
    }

    function test_the_agent_can_spend_the_whole_cap_and_not_a_unit_more() public {
        for (uint256 i = 0; i < CAP / MAX_PER_CALL; ++i) {
            Auth memory a = _auth(payeeA, MAX_PER_CALL);
            _settle(tab, a, _sign(agentKey, tab, a));
        }
        assertEq(USDC.balanceOf(address(tab)), 0);
        assertEq(USDC.balanceOf(payeeA), CAP);

        // The tab itself still says yes -- the signature is fine -- and USDC says no: there is nothing left.
        Auth memory extra = _auth(payeeA, 1);
        bytes memory sig = _sign(agentKey, tab, extra);
        assertEq(tab.isValidSignature(_transferDigest(address(tab), extra), sig), MAGIC);
        vm.expectRevert();
        _settle(tab, extra, sig);
        assertEq(USDC.balanceOf(payeeA), CAP);
    }

    function test_getters_read_back_what_was_decided() public view {
        assertEq(tab.owner(), owner);
        assertEq(tab.agent(), agent);
        assertEq(tab.maxPerCall(), MAX_PER_CALL);
        assertEq(tab.expiry(), expiry);
        address[] memory list = tab.payees();
        assertEq(list.length, 2);
        assertEq(list[0], payeeA);
        assertEq(list[1], payeeB);
        assertFalse(tab.closed());
    }

    function testFuzz_yes_exactly_when_payee_and_within_maximum(address to, uint256 value) public {
        Auth memory a = _auth(to, value);
        bytes memory sig = _sign(agentKey, tab, a);
        bool shouldAccept = (to == payeeA || to == payeeB) && value <= MAX_PER_CALL;
        assertEq(tab.isValidSignature(_transferDigest(address(tab), a), sig), shouldAccept ? MAGIC : REFUSED);
    }
}
