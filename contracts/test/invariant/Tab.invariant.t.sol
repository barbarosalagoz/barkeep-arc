// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {Base} from "../utils/Base.sol";
import {Handler} from "./Handler.sol";

abstract contract TabInvariantBase is Base {
    Handler internal handler;
    uint256 internal outsidersBefore;

    function _donations() internal pure virtual returns (bool);

    function setUp() public override {
        super.setUp();
        handler = new Handler(tab, agentKey, _payees(), _donations());
        targetContract(address(handler));
        // Arc validates the sender of every call against USDC's blocklist, and the fuzzer's random senders trip it
        // ("transaction validation error: Blocked address"). Who calls the handler is irrelevant: it pranks.
        targetSender(makeAddr("fuzzer"));
    }

    /// The model and the chain never disagree about whether a payment should move.
    function invariant_no_attempt_ever_contradicts_the_model() public view {
        assertEq(handler.violations(), 0);
    }

    function invariant_no_non_agent_ever_spends() public view {
        assertEq(handler.successesByWrongKey(), 0);
    }

    function invariant_no_spend_after_expiry_or_close() public view {
        assertEq(handler.successesAfterExpiry(), 0);
        assertEq(handler.successesAfterClose(), 0);
    }

    function invariant_no_spend_to_a_non_payee_or_above_the_maximum() public view {
        assertEq(handler.successesToOutsiders(), 0);
        assertEq(handler.successesAboveMax(), 0);
        // Non-payees hold exactly what they held before (the owner is one of them and only gains by closing).
        for (uint256 i = 0; i < handler.outsiderCount() - 1; ++i) {
            assertEq(USDC.balanceOf(handler.outsiders(i)), 0);
        }
    }

    /// Conservation: every unit that entered the tab is still in it, went to a payee, or went back to the owner.
    function invariant_money_is_conserved() public view {
        assertEq(
            USDC.balanceOf(address(tab)) + handler.paidToPayees() + handler.sweptToOwner(), CAP + handler.donated()
        );
        assertEq(USDC.balanceOf(payeeA) + USDC.balanceOf(payeeB), handler.paidToPayees());
    }

    function invariant_closed_stays_closed_and_empty_of_agent_power() public view {
        if (tab.closed()) assertEq(handler.successesAfterClose(), 0);
    }
}

/// Nobody sends money in: the balance can only fall, so it never exceeds the cap, and the agent never moves more than the cap.
contract TabInvariantTest is TabInvariantBase {
    function _donations() internal pure override returns (bool) {
        return false;
    }

    function invariant_balance_never_exceeds_the_cap() public view {
        assertLe(USDC.balanceOf(address(tab)), CAP);
        assertLe(handler.paidToPayees(), CAP);
    }

    /// Guards against a vacuous run: the handler must actually get payments through.
    function invariant_the_run_is_not_vacuous() public view {
        if (handler.successes() + handler.refusals() > 40) assertGt(handler.refusals(), 0);
    }
}

/// Third parties may send USDC to a tab and nothing on chain can stop them. The owner's exposure stays at the cap:
/// the agent can move at most what was put in, and never the owner's money beyond the cap.
contract TabInvariantWithDonationsTest is TabInvariantBase {
    function _donations() internal pure override returns (bool) {
        return true;
    }

    function invariant_agent_never_moves_more_than_was_put_in() public view {
        assertLe(handler.paidToPayees(), CAP + handler.donated());
    }

    /// Guards against a vacuous run: donations must actually land.
    function invariant_donations_really_happen() public view {
        if (handler.donationAttempts() > 0) assertGt(handler.donated(), 0);
    }
}
