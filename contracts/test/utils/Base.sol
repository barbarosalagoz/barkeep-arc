// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {Tab} from "../../src/Tab.sol";
import {TabFactory} from "../../src/TabFactory.sol";

/// Arc's real USDC, as far as these tests drive it.
interface IUSDCFull {
    function name() external view returns (string memory);
    function version() external view returns (string memory);
    function decimals() external view returns (uint8);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function balanceOf(address) external view returns (uint256);
    function allowance(address, address) external view returns (uint256);
    function nonces(address) external view returns (uint256);
    function authorizationState(address, bytes32) external view returns (bool);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
    function transferWithAuthorization(address, address, uint256, uint256, uint256, bytes32, bytes calldata) external;
    function transferWithAuthorization(address, address, uint256, uint256, uint256, bytes32, uint8, bytes32, bytes32)
        external;
    function receiveWithAuthorization(address, address, uint256, uint256, uint256, bytes32, bytes calldata) external;
    function cancelAuthorization(address, bytes32, bytes calldata) external;
    function permit(address, address, uint256, uint256, bytes calldata) external;
}

/*
 * Every suite runs against Arc's real USDC, not a mock: arc-forge forking a
 * local `arc-anvil --network arc` (or a live Arc network), where the protocol's
 * system contracts exist. See contracts/README.md.
 */
abstract contract Base is Test {
    IUSDCFull internal constant USDC = IUSDCFull(0x3600000000000000000000000000000000000000);

    bytes4 internal constant MAGIC = 0x1626ba7e;
    bytes4 internal constant REFUSED = 0xffffffff;

    bytes32 internal constant TRANSFER_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 internal constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 internal constant CANCEL_TYPEHASH = keccak256("CancelAuthorization(address authorizer,bytes32 nonce)");
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    uint256 internal constant CAP = 10e6; // 10 USDC
    uint256 internal constant MAX_PER_CALL = 1e6; // 1 USDC

    TabFactory internal factory;
    Tab internal tab;

    address internal owner;
    uint256 internal ownerKey;
    address internal agent;
    uint256 internal agentKey;
    address internal stranger;
    uint256 internal strangerKey;
    address internal payeeA = makeAddr("payeeA");
    address internal payeeB = makeAddr("payeeB");
    address internal outsider = makeAddr("outsider");
    address internal relayer = makeAddr("relayer");

    uint64 internal expiry;
    uint256 private nonceCounter;

    struct Auth {
        address to;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
    }

    function setUp() public virtual {
        require(
            address(USDC).code.length != 0,
            "no USDC at 0x3600: run with arc-forge against arc-anvil --network arc (see contracts/README.md)"
        );

        (owner, ownerKey) = makeAddrAndKey("owner");
        (agent, agentKey) = makeAddrAndKey("agent");
        (stranger, strangerKey) = makeAddrAndKey("stranger");

        factory = new TabFactory();
        expiry = uint64(block.timestamp + 1 days);

        // On Arc the native balance IS the USDC balance: 18 decimals native, 6 through the ERC-20 view.
        vm.deal(owner, 1000 ether);
        vm.deal(stranger, 1000 ether);

        tab = _open(owner, _payees(), MAX_PER_CALL, expiry, CAP, bytes32(0));
    }

    function _payees() internal view returns (address[] memory list) {
        list = new address[](2);
        list[0] = payeeA;
        list[1] = payeeB;
    }

    function _open(address who, address[] memory list, uint256 maxPerCall, uint64 until, uint256 cap, bytes32 salt)
        internal
        returns (Tab)
    {
        vm.startPrank(who);
        USDC.approve(address(factory), cap);
        address opened = factory.openTab(agent, list, maxPerCall, until, cap, salt);
        vm.stopPrank();
        return Tab(opened);
    }

    function _auth(address to, uint256 value) internal returns (Auth memory) {
        return Auth(to, value, 0, expiry, keccak256(abi.encode("nonce", ++nonceCounter)));
    }

    function _digest(bytes32 typehash, address from, Auth memory a) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(typehash, from, a.to, a.value, a.validAfter, a.validBefore, a.nonce));
        return keccak256(abi.encodePacked(hex"1901", USDC.DOMAIN_SEPARATOR(), structHash));
    }

    function _transferDigest(address from, Auth memory a) internal view returns (bytes32) {
        return _digest(TRANSFER_TYPEHASH, from, a);
    }

    function _ecdsa(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    /// The 213 bytes a tab expects: the signature, then the fields it was made over.
    function _pack(bytes memory ecdsa, Auth memory a) internal pure returns (bytes memory) {
        return abi.encodePacked(ecdsa, a.to, a.value, a.validAfter, a.validBefore, a.nonce);
    }

    function _sign(uint256 key, Tab from, Auth memory a) internal view returns (bytes memory) {
        return _pack(_ecdsa(key, _transferDigest(address(from), a)), a);
    }

    /// What a facilitator does: anyone may submit, the signature is what counts.
    function _settle(Tab from, Auth memory a, bytes memory signature) internal {
        vm.prank(relayer);
        USDC.transferWithAuthorization(address(from), a.to, a.value, a.validAfter, a.validBefore, a.nonce, signature);
    }

    function _expectRefusedOnChain(Tab from, Auth memory a, bytes memory signature) internal {
        uint256 before = USDC.balanceOf(address(from));
        vm.expectRevert(bytes("FiatTokenV2: invalid signature"));
        _settle(from, a, signature);
        assertEq(USDC.balanceOf(address(from)), before, "a refused payment moved money");
    }
}
