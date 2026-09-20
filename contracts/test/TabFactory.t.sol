// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {Errors} from "@openzeppelin/contracts/utils/Errors.sol";

import {MAX_PAYEES, Tab} from "../src/Tab.sol";
import {TabFactory} from "../src/TabFactory.sol";
import {Base} from "./utils/Base.sol";

contract TabFactoryTest is Base {
    function test_a_tab_is_funded_with_exactly_the_cap_and_the_factory_keeps_nothing() public view {
        assertEq(USDC.balanceOf(address(tab)), CAP);
        assertEq(USDC.balanceOf(address(factory)), 0);
        assertEq(USDC.allowance(owner, address(factory)), 0);
    }

    function test_the_address_is_known_beforehand() public {
        bytes32 salt = bytes32(uint256(42));
        address predicted = factory.predictTab(owner, agent, _payees(), MAX_PER_CALL, expiry, salt);
        assertEq(predicted.code.length, 0);
        Tab opened = _open(owner, _payees(), MAX_PER_CALL, expiry, CAP, salt);
        assertEq(address(opened), predicted);
    }

    function test_the_address_depends_on_who_opens_it() public {
        bytes32 salt = bytes32(uint256(42));
        address forOwner = factory.predictTab(owner, agent, _payees(), MAX_PER_CALL, expiry, salt);
        Tab byStranger = _open(stranger, _payees(), MAX_PER_CALL, expiry, CAP, salt);
        assertTrue(address(byStranger) != forOwner);
        assertEq(byStranger.owner(), stranger);

        // So a stranger going first does not stop the owner.
        Tab byOwner = _open(owner, _payees(), MAX_PER_CALL, expiry, CAP, salt);
        assertEq(address(byOwner), forOwner);
    }

    function test_the_address_depends_on_the_terms() public view {
        address a = factory.predictTab(owner, agent, _payees(), MAX_PER_CALL, expiry, bytes32(0));
        address b = factory.predictTab(owner, agent, _payees(), MAX_PER_CALL + 1, expiry, bytes32(0));
        assertTrue(a != b);
        assertEq(a, address(tab));
    }

    function test_the_same_tab_cannot_be_opened_twice() public {
        vm.startPrank(owner);
        USDC.approve(address(factory), CAP);
        vm.expectRevert(Errors.FailedDeployment.selector);
        factory.openTab(agent, _payees(), MAX_PER_CALL, expiry, CAP, bytes32(0));
        vm.stopPrank();
    }

    function test_opening_announces_the_terms() public {
        bytes32 salt = bytes32(uint256(7));
        address predicted = factory.predictTab(owner, agent, _payees(), MAX_PER_CALL, expiry, salt);
        vm.startPrank(owner);
        USDC.approve(address(factory), CAP);
        vm.expectEmit(true, true, true, true, address(factory));
        emit TabFactory.TabOpened(predicted, owner, agent, CAP, MAX_PER_CALL, expiry, _payees());
        factory.openTab(agent, _payees(), MAX_PER_CALL, expiry, CAP, salt);
        vm.stopPrank();
    }

    function test_without_an_allowance_nothing_opens() public {
        bytes32 salt = bytes32(uint256(8));
        address predicted = factory.predictTab(owner, agent, _payees(), MAX_PER_CALL, expiry, salt);
        vm.prank(owner);
        vm.expectRevert(bytes("ERC20: transfer amount exceeds allowance"));
        factory.openTab(agent, _payees(), MAX_PER_CALL, expiry, CAP, salt);
        assertEq(predicted.code.length, 0);
    }

    function test_bad_terms_are_rejected() public {
        address[] memory none = new address[](0);
        address[] memory tooMany = new address[](MAX_PAYEES + 1);
        for (uint256 i = 0; i < tooMany.length; ++i) {
            tooMany[i] = address(uint160(i + 1));
        }
        address[] memory withZero = _payees();
        withZero[1] = address(0);

        vm.startPrank(owner);
        USDC.approve(address(factory), CAP);

        vm.expectRevert(TabFactory.ZeroAgent.selector);
        factory.openTab(address(0), _payees(), MAX_PER_CALL, expiry, CAP, bytes32(uint256(9)));
        vm.expectRevert(TabFactory.BadPayeeCount.selector);
        factory.openTab(agent, none, MAX_PER_CALL, expiry, CAP, bytes32(uint256(9)));
        vm.expectRevert(TabFactory.BadPayeeCount.selector);
        factory.openTab(agent, tooMany, MAX_PER_CALL, expiry, CAP, bytes32(uint256(9)));
        vm.expectRevert(TabFactory.ZeroPayee.selector);
        factory.openTab(agent, withZero, MAX_PER_CALL, expiry, CAP, bytes32(uint256(9)));
        vm.expectRevert(TabFactory.ZeroCap.selector);
        factory.openTab(agent, _payees(), MAX_PER_CALL, expiry, 0, bytes32(uint256(9)));
        vm.expectRevert(TabFactory.ZeroMaxPerCall.selector);
        factory.openTab(agent, _payees(), 0, expiry, CAP, bytes32(uint256(9)));
        vm.expectRevert(TabFactory.MaxPerCallAboveCap.selector);
        factory.openTab(agent, _payees(), CAP + 1, expiry, CAP, bytes32(uint256(9)));
        vm.expectRevert(TabFactory.ExpiryNotInFuture.selector);
        factory.openTab(agent, _payees(), MAX_PER_CALL, uint64(block.timestamp), CAP, bytes32(uint256(9)));
        vm.stopPrank();
    }

    function test_twenty_payees_open_and_the_last_one_can_be_paid() public {
        address[] memory list = new address[](MAX_PAYEES);
        for (uint256 i = 0; i < list.length; ++i) {
            list[i] = address(uint160(0xBEEF00 + i));
        }
        Tab big = _open(owner, list, MAX_PER_CALL, expiry, CAP, bytes32(uint256(20)));
        Auth memory a = _auth(list[MAX_PAYEES - 1], 1);
        _settle(big, a, _sign(agentKey, big, a));
        assertEq(USDC.balanceOf(list[MAX_PAYEES - 1]), 1);
    }

    function test_the_factory_has_nothing_to_administer() public view {
        // IMPLEMENTATION, USDC, openTab, predictTab: the whole external surface.
        assertEq(factory.IMPLEMENTATION().code.length > 0, true);
        assertEq(address(factory.USDC()), address(USDC));
    }

    /// As with close: only a mocked false reaches this branch. The whole transaction reverts, so no unfunded tab is left.
    function test_a_false_return_from_usdc_reverts_the_opening() public {
        bytes32 salt = bytes32(uint256(77));
        address predicted = factory.predictTab(owner, agent, _payees(), MAX_PER_CALL, expiry, salt);
        vm.prank(owner);
        USDC.approve(address(factory), CAP);

        vm.mockCall(
            address(USDC),
            abi.encodeWithSelector(bytes4(keccak256("transferFrom(address,address,uint256)"))),
            abi.encode(false)
        );
        vm.prank(owner);
        vm.expectRevert(TabFactory.FundingFailed.selector);
        factory.openTab(agent, _payees(), MAX_PER_CALL, expiry, CAP, salt);
        vm.clearMockedCalls();

        assertEq(predicted.code.length, 0);
    }
}
