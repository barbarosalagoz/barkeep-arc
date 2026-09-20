// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

/// The three calls the tab and its factory make on USDC. On Arc this is the
/// ERC-20 view (6 decimals) of the native balance, at 0x3600….
interface IUSDC {
    function balanceOf(address account) external view returns (uint256);

    function transfer(address to, uint256 value) external returns (bool);

    function transferFrom(address from, address to, uint256 value) external returns (bool);
}
