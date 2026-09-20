// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

import {IUSDC} from "./IUSDC.sol";

// The most payees a tab can name. The factory enforces it; a tab only reads its list.
uint256 constant MAX_PAYEES = 20;

/*
 * A tab: a budget an AI agent can spend, and nothing else.
 *
 * One of these is cloned per tab and funded with exactly the cap, so the
 * balance IS the limit -- there is no spent-so-far counter to get wrong. The
 * agent never holds the money. It holds a key whose only power is to make this
 * contract answer "yes" when USDC asks, through ERC-1271, whether a
 * TransferWithAuthorization out of this tab is signed.
 *
 * Everything the human decided lives in the clone's own bytecode (EIP-1167
 * with immutable arguments): owner, agent, the per-call maximum, the expiry and
 * the payees. There is no initializer to front-run, no setter, no upgrade path.
 * The only storage is one bit: closed.
 *
 * Why no replay counter: USDC's EIP-3009 burns the authorization's nonce on
 * first use, and the digest the agent signs names this tab as `from`, so an
 * authorization is good once, here, and nowhere else. Replaying everything the
 * agent ever signed moves nothing, and signing new ones can never move more
 * than the balance.
 *
 * Unaudited.
 */
contract Tab is IERC1271 {
    /// USDC on Arc: the ERC-20 view of the native balance. Same address on mainnet and testnet.
    IUSDC public constant USDC = IUSDC(0x3600000000000000000000000000000000000000);

    bytes4 private constant MAGIC = IERC1271.isValidSignature.selector;
    bytes4 private constant REFUSED = 0xffffffff;

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant USDC_NAME_HASH = keccak256("USDC");
    bytes32 private constant USDC_VERSION_HASH = keccak256("2");
    bytes32 private constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    /*
     * The signature USDC hands to isValidSignature, packed:
     *
     *   [0:65]     the agent's ECDSA signature (r, s, v) over the digest
     *   [65:85]    to
     *   [85:117]   value
     *   [117:149]  validAfter
     *   [149:181]  validBefore
     *   [181:213]  nonce
     *
     * ERC-1271 passes only a hash. The fields ride along so the tab can rebuild
     * that hash itself and so know WHAT it is being asked to approve.
     */
    uint256 private constant SIGNATURE_LENGTH = 213;

    /// The implementation's own address, so the implementation itself can refuse to act as a tab.
    address private immutable SELF = address(this);

    /// Set by close(), never unset. The only storage a tab has.
    bool public closed;

    struct Terms {
        address owner;
        address agent;
        uint256 maxPerCall;
        uint64 expiry;
        address[] payees;
    }

    /// `swept` is false when USDC refused the transfer: the tab is closed, the money is still in it.
    event Closed(address indexed owner, uint256 amount, bool swept);

    error NotATab();
    error NotOwner();

    /* ---- what the human decided, read back from the clone's bytecode -------- */

    function terms() public view returns (Terms memory) {
        if (address(this) == SELF) revert NotATab();
        return abi.decode(Clones.fetchCloneArgs(address(this)), (Terms));
    }

    function owner() external view returns (address) {
        return terms().owner;
    }

    function agent() external view returns (address) {
        return terms().agent;
    }

    function maxPerCall() external view returns (uint256) {
        return terms().maxPerCall;
    }

    function expiry() external view returns (uint64) {
        return terms().expiry;
    }

    function payees() external view returns (address[] memory) {
        return terms().payees;
    }

    function balance() external view returns (uint256) {
        return USDC.balanceOf(address(this));
    }

    /* ---- the agent's one power ---------------------------------------------- */

    /**
     * Magic value only for a TransferWithAuthorization on Arc's USDC, from this
     * tab, signed by the agent, to a payee, at or under the per-call maximum,
     * that cannot outlive the tab. Anything else gets the same refusal, with no
     * reason attached: this never reverts to say why.
     */
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        if (address(this) == SELF) return REFUSED;
        if (closed) return REFUSED;
        if (signature.length != SIGNATURE_LENGTH) return REFUSED;

        address to = address(bytes20(signature[65:85]));
        uint256 value = uint256(bytes32(signature[85:117]));
        uint256 validAfter = uint256(bytes32(signature[117:149]));
        uint256 validBefore = uint256(bytes32(signature[149:181]));
        bytes32 nonce = bytes32(signature[181:213]);

        // The hash must be exactly the transfer those fields describe. A permit, a
        // receiveWithAuthorization, a cancelAuthorization, another token's or another
        // chain's transfer, or another tab's, all hash to something else.
        if (hash != _transferDigest(to, value, validAfter, validBefore, nonce)) return REFUSED;

        Terms memory t = abi.decode(Clones.fetchCloneArgs(address(this)), (Terms));

        // The third value only carries detail for an error message, and this function gives no reasons.
        // slither-disable-next-line unused-return
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(hash, signature[0:65]);
        if (err != ECDSA.RecoverError.NoError || recovered != t.agent) return REFUSED;

        if (block.timestamp > t.expiry) return REFUSED;
        // An authorization still usable after the tab expires would be a spend after expiry.
        if (validBefore > t.expiry) return REFUSED;
        if (value > t.maxPerCall) return REFUSED;
        if (!_isPayee(t.payees, to)) return REFUSED;

        return MAGIC;
    }

    /* ---- the owner's one power ---------------------------------------------- */

    /**
     * Closes the tab for good and sends whatever USDC is left to the owner.
     *
     * Revoking the agent must not depend on the money moving. If USDC refuses the
     * transfer (the owner is a contract that has been blocklisted, USDC is
     * paused), the tab is closed all the same, `swept` is false, and close() can
     * be called again later to collect. Calling it again is also how the owner
     * collects anything a third party sent in after the close, which the agent
     * could never have spent anyway.
     */
    function close() external {
        Terms memory t = terms();
        if (msg.sender != t.owner) revert NotOwner();

        closed = true;

        uint256 amount = USDC.balanceOf(address(this));
        bool swept = false;
        try USDC.transfer(t.owner, amount) returns (bool ok) {
            swept = ok;
        } catch {}
        emit Closed(t.owner, amount, swept);
    }

    /* ---- internals ---------------------------------------------------------- */

    /// USDC's own EIP-712 digest for a TransferWithAuthorization out of this tab.
    function _transferDigest(address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        private
        view
        returns (bytes32)
    {
        bytes32 domainSeparator = keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, USDC_NAME_HASH, USDC_VERSION_HASH, block.chainid, address(USDC))
        );
        bytes32 structHash = keccak256(
            abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, address(this), to, value, validAfter, validBefore, nonce)
        );
        return keccak256(abi.encodePacked(hex"1901", domainSeparator, structHash));
    }

    function _isPayee(address[] memory list, address who) private pure returns (bool) {
        for (uint256 i = 0; i < list.length; ++i) {
            if (list[i] == who) return true;
        }
        return false;
    }
}
