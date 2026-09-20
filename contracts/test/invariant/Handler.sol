// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {Tab} from "../../src/Tab.sol";
import {IUSDCFull} from "../utils/Base.sol";

/*
 * Drives one tab with everything anyone could try: the agent paying well and
 * badly, other keys signing, time passing, the owner closing, non-owners trying
 * to close and, when donations are on, third parties sending money in.
 *
 * Each attempt is judged against a model written independently of the contract:
 * it should move money iff the signer is the agent, the payee is listed, the
 * value is within the maximum, the tab is open and unexpired, the authorization
 * does not outlive the tab, and the balance covers it. Any disagreement, in
 * either direction, is counted in `violations`.
 */
contract Handler is Test {
    IUSDCFull internal constant USDC = IUSDCFull(0x3600000000000000000000000000000000000000);
    bytes32 internal constant TRANSFER_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    Tab public immutable tab;
    address public immutable owner;
    uint256 internal immutable agentKey;
    uint256 public immutable maxPerCall;
    uint64 public immutable expiry;
    bool public immutable donationsOn;

    address[] public payees;
    address[] public outsiders;
    uint256[] internal wrongKeys;

    uint256 internal nonceCounter;

    // Ghosts.
    uint256 public violations;
    uint256 public paidToPayees;
    uint256 public donated;
    uint256 public donationAttempts;
    uint256 public sweptToOwner;
    uint256 public successes;
    uint256 public refusals;
    uint256 public successesAfterExpiry;
    uint256 public successesAfterClose;
    uint256 public successesByWrongKey;
    uint256 public successesToOutsiders;
    uint256 public successesAboveMax;

    constructor(Tab tab_, uint256 agentKey_, address[] memory payees_, bool donationsOn_) {
        tab = tab_;
        owner = tab_.owner();
        agentKey = agentKey_;
        maxPerCall = tab_.maxPerCall();
        expiry = tab_.expiry();
        donationsOn = donationsOn_;
        payees = payees_;
        for (uint256 i = 0; i < 3; ++i) {
            outsiders.push(makeAddr(string(abi.encodePacked("outsider", i))));
            (, uint256 key) = makeAddrAndKey(string(abi.encodePacked("wrongKey", i)));
            wrongKeys.push(key);
        }
        outsiders.push(vm.addr(agentKey_)); // the agent paying itself
        outsiders.push(owner);
    }

    /* ---- actions ------------------------------------------------------------- */

    function agentPaysPayee(uint256 payeeSeed, uint256 value, uint256 validBeforeSeed) external {
        _attempt(agentKey, true, payees[payeeSeed % payees.length], true, bound(value, 0, maxPerCall), validBeforeSeed);
    }

    function agentPaysAboveMax(uint256 payeeSeed, uint256 value) external {
        _attempt(
            agentKey, true, payees[payeeSeed % payees.length], true, bound(value, maxPerCall + 1, maxPerCall * 5), 0
        );
    }

    function agentPaysOutsider(uint256 seed, uint256 value) external {
        _attempt(agentKey, true, outsiders[seed % outsiders.length], false, bound(value, 0, maxPerCall), 0);
    }

    function wrongKeyPays(uint256 keySeed, uint256 payeeSeed, uint256 value) external {
        _attempt(
            wrongKeys[keySeed % wrongKeys.length],
            false,
            payees[payeeSeed % payees.length],
            true,
            bound(value, 0, maxPerCall),
            0
        );
    }

    function timePasses(uint256 by) external {
        vm.warp(block.timestamp + bound(by, 1, 12 hours));
    }

    function ownerCloses() external {
        uint256 before = USDC.balanceOf(address(tab));
        vm.prank(owner);
        tab.close();
        sweptToOwner += before;
        if (USDC.balanceOf(address(tab)) != 0 || !tab.closed()) ++violations;
    }

    function someoneElseTriesToClose(uint256 seed) external {
        address who = seed % 2 == 0 ? vm.addr(agentKey) : outsiders[seed % 3];
        bool wasClosed = tab.closed();
        uint256 before = USDC.balanceOf(address(tab));
        vm.prank(who);
        try tab.close() {
            ++violations;
        } catch {}
        if (tab.closed() != wasClosed || USDC.balanceOf(address(tab)) != before) ++violations;
    }

    function someoneDonates(uint256 amount) external {
        if (!donationsOn) return;
        ++donationAttempts;
        amount = bound(amount, 1, 5e6);
        address donor = makeAddr("donor");
        // Leave the donor something: Arc refuses a transfer that would empty a fresh account
        // ("Cannot clear balance of empty account").
        vm.deal(donor, 1 ether + amount * 1e12);
        vm.prank(donor);
        USDC.transfer(address(tab), amount);
        donated += amount;
    }

    /* ---- the judge ----------------------------------------------------------- */

    struct Attempt {
        uint256 key;
        bool isAgent;
        address to;
        bool isPayee;
        uint256 value;
        uint256 validBefore;
        bytes32 nonce;
    }

    function _attempt(uint256 key, bool isAgent, address to, bool isPayee, uint256 value, uint256 validBeforeSeed)
        internal
    {
        // Mostly authorizations that die with the tab; sometimes ones that would outlive it.
        uint256 validBefore = validBeforeSeed % 4 == 3 ? uint256(expiry) + 1 + (validBeforeSeed % 1 days) : expiry;
        bytes32 nonce = keccak256(abi.encode("handler", ++nonceCounter));
        _judge(Attempt(key, isAgent, to, isPayee, value, validBefore, nonce));
    }

    function _signature(Attempt memory a) internal view returns (bytes memory) {
        bytes32 structHash =
            keccak256(abi.encode(TRANSFER_TYPEHASH, address(tab), a.to, a.value, 0, a.validBefore, a.nonce));
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", USDC.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(a.key, digest);
        return abi.encodePacked(r, s, v, a.to, a.value, uint256(0), a.validBefore, a.nonce);
    }

    function _judge(Attempt memory a) internal {
        uint256 balanceBefore = USDC.balanceOf(address(tab));
        bool closed = tab.closed();
        bool expired = block.timestamp > expiry;
        bool shouldMove = a.isAgent && a.isPayee && a.value <= maxPerCall && !closed && !expired
            && a.validBefore <= expiry && block.timestamp < a.validBefore && a.value <= balanceBefore;

        bool moved;
        try USDC.transferWithAuthorization(address(tab), a.to, a.value, 0, a.validBefore, a.nonce, _signature(a)) {
            moved = true;
        } catch {}

        if (moved != shouldMove) ++violations;

        if (moved) {
            ++successes;
            paidToPayees += a.value;
            if (USDC.balanceOf(address(tab)) != balanceBefore - a.value) ++violations;
            if (expired) ++successesAfterExpiry;
            if (closed) ++successesAfterClose;
            if (!a.isAgent) ++successesByWrongKey;
            if (!a.isPayee) ++successesToOutsiders;
            if (a.value > maxPerCall) ++successesAboveMax;
        } else {
            ++refusals;
            if (USDC.balanceOf(address(tab)) != balanceBefore) ++violations;
        }
    }

    function outsiderCount() external view returns (uint256) {
        return outsiders.length;
    }
}
