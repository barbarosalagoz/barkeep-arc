// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {Base} from "./utils/Base.sol";

/// If these fail, nothing else in the suite means anything: the tests are not running against Arc's USDC.
contract SanityTest is Base {
    function test_usdc_is_the_real_thing() public view {
        assertGt(address(USDC).code.length, 0);
        assertEq(USDC.name(), "USDC");
        assertEq(USDC.version(), "2");
        assertEq(USDC.decimals(), 6);
    }

    function test_the_domain_the_tab_hardcodes_is_usdcs_own() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("USDC"),
                keccak256("2"),
                block.chainid,
                address(USDC)
            )
        );
        assertEq(USDC.DOMAIN_SEPARATOR(), expected);
    }

    function test_native_balance_and_erc20_view_are_one_balance() public {
        address who = makeAddr("who");
        vm.deal(who, 3 ether);
        assertEq(USDC.balanceOf(who), 3e6);
    }
}
