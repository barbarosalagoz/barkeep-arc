// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {Tab} from "../src/Tab.sol";
import {Base} from "./utils/Base.sol";

/// Every refusal is checked twice: the tab answers 0xffffffff, and USDC, asked to move the money, reverts and moves none.
contract TabRefuseTest is Base {
    function _refused(Auth memory a, bytes memory sig) internal {
        assertEq(tab.isValidSignature(_transferDigest(address(tab), a), sig), REFUSED);
        _expectRefusedOnChain(tab, a, sig);
    }

    function test_a_stranger_cannot_spend() public {
        Auth memory a = _auth(payeeA, 1);
        _refused(a, _sign(strangerKey, tab, a));
    }

    function test_the_owner_key_is_not_the_agent_key() public {
        Auth memory a = _auth(payeeA, 1);
        _refused(a, _sign(ownerKey, tab, a));
    }

    function test_agent_cannot_pay_a_non_payee() public {
        Auth memory a = _auth(outsider, 1);
        _refused(a, _sign(agentKey, tab, a));
    }

    function test_agent_cannot_pay_itself() public {
        Auth memory a = _auth(agent, 1);
        _refused(a, _sign(agentKey, tab, a));
    }

    function test_agent_cannot_pay_above_the_maximum() public {
        Auth memory a = _auth(payeeA, MAX_PER_CALL + 1);
        _refused(a, _sign(agentKey, tab, a));
    }

    function test_agent_cannot_pay_after_expiry() public {
        Auth memory a = _auth(payeeA, 1);
        bytes memory sig = _sign(agentKey, tab, a);
        vm.warp(uint256(expiry) + 1);
        assertEq(tab.isValidSignature(_transferDigest(address(tab), a), sig), REFUSED);
        // USDC itself also rejects it as expired, since validBefore <= expiry; either way nothing moves.
        vm.expectRevert();
        _settle(tab, a, sig);
        assertEq(USDC.balanceOf(address(tab)), CAP);
    }

    function test_an_authorization_that_outlives_the_tab_is_refused_even_today() public {
        Auth memory a = _auth(payeeA, 1);
        a.validBefore = uint256(expiry) + 1;
        _refused(a, _sign(agentKey, tab, a));
    }

    function test_a_post_dated_authorization_cannot_be_cashed_after_expiry() public {
        Auth memory a = _auth(payeeA, 1);
        a.validBefore = type(uint256).max;
        bytes memory sig = _sign(agentKey, tab, a);
        vm.warp(uint256(expiry) + 30 days);
        _refused(a, sig);
    }

    function test_a_bare_65_byte_signature_is_refused() public {
        Auth memory a = _auth(payeeA, 1);
        _refused(a, _ecdsa(agentKey, _transferDigest(address(tab), a)));
    }

    function test_usdcs_v_r_s_overload_is_refused() public {
        Auth memory a = _auth(payeeA, 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentKey, _transferDigest(address(tab), a));
        vm.expectRevert(bytes("FiatTokenV2: invalid signature"));
        USDC.transferWithAuthorization(address(tab), a.to, a.value, a.validAfter, a.validBefore, a.nonce, v, r, s);
    }

    function test_one_byte_short_or_long_is_refused() public {
        Auth memory a = _auth(payeeA, 1);
        bytes memory sig = _sign(agentKey, tab, a);
        bytes32 digest = _transferDigest(address(tab), a);

        bytes memory longer = abi.encodePacked(sig, bytes1(0));
        assertEq(tab.isValidSignature(digest, longer), REFUSED);

        bytes memory shorter = new bytes(sig.length - 1);
        for (uint256 i = 0; i < shorter.length; ++i) {
            shorter[i] = sig[i];
        }
        assertEq(tab.isValidSignature(digest, shorter), REFUSED);
        assertEq(tab.isValidSignature(digest, ""), REFUSED);
    }

    /// The agent signs a transfer to an outsider, then dresses it up with fields naming a payee.
    function test_fields_that_do_not_match_the_hash_are_refused() public {
        Auth memory real = _auth(outsider, 5e6);
        bytes memory ecdsa = _ecdsa(agentKey, _transferDigest(address(tab), real));

        Auth memory claimed = real;
        claimed.to = payeeA;
        claimed.value = 1;

        assertEq(tab.isValidSignature(_transferDigest(address(tab), real), _pack(ecdsa, claimed)), REFUSED);
        _expectRefusedOnChain(tab, real, _pack(ecdsa, claimed));
    }

    function test_a_signature_for_another_tab_is_refused() public {
        Tab other = _open(owner, _payees(), MAX_PER_CALL, expiry, CAP, bytes32(uint256(1)));
        Auth memory a = _auth(payeeA, 1);
        bytes memory forOther = _sign(agentKey, other, a);

        assertEq(tab.isValidSignature(_transferDigest(address(other), a), forOther), REFUSED);
        _expectRefusedOnChain(tab, a, forOther);
    }

    function test_a_signature_for_another_chain_is_refused() public {
        Auth memory a = _auth(payeeA, 1);
        bytes memory sig = _sign(agentKey, tab, a);
        bytes32 digest = _transferDigest(address(tab), a);
        assertEq(tab.isValidSignature(digest, sig), MAGIC);

        vm.chainId(block.chainid + 1);
        assertEq(tab.isValidSignature(digest, sig), REFUSED);
    }

    function test_a_malleated_high_s_signature_is_refused() public {
        Auth memory a = _auth(payeeA, 1);
        bytes32 digest = _transferDigest(address(tab), a);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentKey, digest);
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory flipped = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        _refused(a, _pack(flipped, a));
    }

    function test_an_authorization_cannot_be_replayed() public {
        Auth memory a = _auth(payeeA, 1);
        bytes memory sig = _sign(agentKey, tab, a);
        _settle(tab, a, sig);
        assertTrue(USDC.authorizationState(address(tab), a.nonce));

        vm.expectRevert(bytes("FiatTokenV2: authorization is used or canceled"));
        _settle(tab, a, sig);
        assertEq(USDC.balanceOf(payeeA), 1);
    }

    /* ---- the other things USDC asks a contract to sign for ------------------- */

    function test_agent_cannot_permit_an_allowance() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, address(tab), stranger, CAP, USDC.nonces(address(tab)), deadline));
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", USDC.DOMAIN_SEPARATOR(), structHash));

        // Even with well-formed transfer fields appended: the hash is a permit, not the transfer they describe.
        Auth memory a = _auth(payeeA, 1);
        bytes memory sig = _pack(_ecdsa(agentKey, digest), a);
        assertEq(tab.isValidSignature(digest, sig), REFUSED);

        vm.expectRevert();
        USDC.permit(address(tab), stranger, CAP, deadline, sig);
        assertEq(USDC.allowance(address(tab), stranger), 0);
    }

    function test_agent_cannot_authorize_a_receive() public {
        Auth memory a = _auth(payeeA, 1);
        bytes32 digest = _digest(RECEIVE_TYPEHASH, address(tab), a);
        bytes memory sig = _pack(_ecdsa(agentKey, digest), a);
        assertEq(tab.isValidSignature(digest, sig), REFUSED);

        vm.prank(payeeA);
        vm.expectRevert();
        USDC.receiveWithAuthorization(address(tab), a.to, a.value, a.validAfter, a.validBefore, a.nonce, sig);
        assertEq(USDC.balanceOf(address(tab)), CAP);
    }

    function test_agent_cannot_cancel_an_authorization() public {
        Auth memory a = _auth(payeeA, 1);
        bytes32 digest = keccak256(
            abi.encodePacked(
                hex"1901", USDC.DOMAIN_SEPARATOR(), keccak256(abi.encode(CANCEL_TYPEHASH, address(tab), a.nonce))
            )
        );
        bytes memory sig = _pack(_ecdsa(agentKey, digest), a);
        vm.expectRevert();
        USDC.cancelAuthorization(address(tab), a.nonce, sig);
        assertFalse(USDC.authorizationState(address(tab), a.nonce));
    }

    /* ---- never a revert, never a reason -------------------------------------- */

    function testFuzz_arbitrary_bytes_are_refused_without_reverting(bytes32 hash, bytes calldata junk) public view {
        assertEq(tab.isValidSignature(hash, junk), REFUSED);
    }

    function testFuzz_arbitrary_213_bytes_are_refused_without_reverting(bytes32 hash, bytes32[7] calldata words)
        public
        view
    {
        bytes memory junk = abi.encodePacked(words);
        bytes memory sized = new bytes(213);
        for (uint256 i = 0; i < 213; ++i) {
            sized[i] = junk[i];
        }
        assertEq(tab.isValidSignature(hash, sized), REFUSED);
    }

    function testFuzz_a_wrong_key_never_passes(uint256 key, uint256 value) public {
        key = bound(key, 1, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140);
        vm.assume(key != agentKey);
        Auth memory a = _auth(payeeA, bound(value, 0, MAX_PER_CALL));
        assertEq(tab.isValidSignature(_transferDigest(address(tab), a), _sign(key, tab, a)), REFUSED);
    }

    /* ---- the implementation is not a tab ------------------------------------- */

    function test_the_implementation_refuses_to_act_as_a_tab() public {
        Tab implementation = Tab(factory.IMPLEMENTATION());
        Auth memory a = _auth(payeeA, 1);
        assertEq(
            implementation.isValidSignature(
                _transferDigest(address(implementation), a), _sign(agentKey, implementation, a)
            ),
            REFUSED
        );
        vm.expectRevert(Tab.NotATab.selector);
        implementation.terms();
        vm.expectRevert(Tab.NotATab.selector);
        implementation.close();
    }
}
