# Graph Report - barkeep-arc  (2026-09-20)

## Corpus Check
- Corpus is ~3,096 words - fits in a single context window. You may not need a graph.

## Summary
- 292 nodes · 865 edges · 10 communities (9 shown, 1 thin omitted)
- Extraction: 84% EXTRACTED · 16% INFERRED · 0% AMBIGUOUS · INFERRED: 138 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- isValidSignature & Signing Helpers
- Tooling, Arc Foundry & Docs
- Security Checks & Mutation Coverage
- TabFactory & Opening
- Tab Terms & Getters
- USDC Interface & Close
- Invariant Ghosts & Donations
- Real USDC Test Interface
- Mutation Script Imports
- Arc Foundry Installer

## God Nodes (most connected - your core abstractions)
1. `Tab.isValidSignature()` - 46 edges
2. `SECURITY.md (phase 1: contracts)` - 41 edges
3. `Handler (invariant handler contract)` - 36 edges
4. `Tab (contract)` - 33 edges
5. `Base._auth()` - 33 edges
6. `Base._sign()` - 30 edges
7. `Base (abstract test contract)` - 28 edges
8. `TabFactory.openTab()` - 26 edges
9. `TabRefuseTest (test contract)` - 26 edges
10. `Tab.close()` - 23 edges

## Surprising Connections (you probably didn't know these)
- `Terms live in the clone's bytecode (EIP-1167 immutable args, CREATE2): no setter, initializer or upgrade path` --semantically_similar_to--> `Design: immutable clone arguments instead of initialize()`  [INFERRED] [semantically similar]
  README.md → docs/SECURITY.md
- `Design: no assembly in src/ (only inside OpenZeppelin Clones and ECDSA)` --references--> `ECDSA.tryRecoverCalldata() [OpenZeppelin]`  [INFERRED]
  docs/SECURITY.md → contracts/src/Tab.sol
- `Design: immutable clone arguments instead of initialize()` --rationale_for--> `Tab.terms()`  [INFERRED]
  docs/SECURITY.md → contracts/src/Tab.sol
- `Terms live in the clone's bytecode (EIP-1167 immutable args, CREATE2): no setter, initializer or upgrade path` --rationale_for--> `Tab.terms()`  [INFERRED]
  README.md → contracts/src/Tab.sol
- `Non-promise: isValidSignature is a view, so it cannot rate-limit; a leaked agent key can drain the tab to the payees` --references--> `Tab.isValidSignature()`  [EXTRACTED]
  docs/SECURITY.md → contracts/src/Tab.sol

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Guards on Tab.isValidSignature (every path to MAGIC passes all nine)** — contracts_src_tab_isvalidsignature, contracts_src_tab_check_not_implementation, contracts_src_tab_check_not_closed, contracts_src_tab_check_signature_length, contracts_src_tab_check_hash_matches_transfer_digest, contracts_src_tab_check_signer_is_agent, contracts_src_tab_check_not_expired, contracts_src_tab_check_validbefore_within_expiry, contracts_src_tab_check_value_within_maxpercall, contracts_src_tab_check_to_is_payee [EXTRACTED 1.00]
- **Settlement flow: relayer -> USDC.transferWithAuthorization -> Tab.isValidSignature -> digest rebuild + ECDSA recover** — contracts_test_utils_base_settle, contracts_test_utils_base_iusdcfull_transferwithauthorization_bytes, contracts_src_tab_isvalidsignature, contracts_src_tab_transferdigest, openzeppelin_ecdsa_tryrecovercalldata, contracts_src_tab_ispayee [INFERRED 0.95]
- **Every external USDC call made by src/ (the reentrancy / trust surface)** — contracts_src_tabfactory_opentab, contracts_src_iusdc_iusdc_transferfrom, contracts_src_tab_close, contracts_src_iusdc_iusdc_transfer, contracts_src_iusdc_iusdc_balanceof, contracts_src_tab_balance [EXTRACTED 1.00]

## Communities (10 total, 1 thin omitted)

### Community 0 - "isValidSignature & Signing Helpers"
Cohesion: 0.11
Nodes (63): isValidSignature check: hash != rebuilt transfer digest -> REFUSED, isValidSignature check: signature.length != 213 -> REFUSED, Tab.isValidSignature(), Tab.SIGNATURE_LENGTH (constant = 213), Handler._signature(), TabAcceptTest (test contract), TabAcceptTest.test_agent_pays_a_payee_within_the_maximum(), TabAcceptTest.test_agent_pays_exactly_the_maximum() (+55 more)

### Community 1 - "Tooling, Arc Foundry & Docs"
Cohesion: 0.06
Nodes (41): Contracts README, arc-anvil --network arc deploys Arc's system contracts; tests fork from it, Arc Foundry (arc-forge / arc-cast / arc-anvil v0.8.0-1), not upstream Foundry, Arc quirk: native balance (18 decimals) and USDC ERC-20 view (6 decimals) are one balance; vm.deal funds USDC, slither.config.json fails on medium and above, SanityTest (test contract), SanityTest.test_native_balance_and_erc20_view_are_one_balance(), IUSDCFull.transferWithAuthorization(v, r, s) (+33 more)

### Community 2 - "Security Checks & Mutation Coverage"
Cohesion: 0.09
Nodes (42): script/mutation-check.py: removes each security check in turn, every mutant must die, isValidSignature check: closed -> REFUSED, isValidSignature check: block.timestamp > expiry -> REFUSED, isValidSignature check: ECDSA recover error or signer != agent -> REFUSED, isValidSignature check: to not in payees -> REFUSED, isValidSignature check: validBefore > expiry -> REFUSED, isValidSignature check: value > maxPerCall -> REFUSED, Tab.REFUSED (constant 0xffffffff) (+34 more)

### Community 3 - "TabFactory & Opening"
Cohesion: 0.12
Nodes (41): IUSDC.transferFrom() [external USDC call], MAX_PAYEES (file-level constant = 20), TabFactory.BadPayeeCount (error), TabFactory.constructor(), TabFactory.ExpiryNotInFuture (error), TabFactory.FundingFailed (error), TabFactory.IMPLEMENTATION (immutable), TabFactory.MaxPerCallAboveCap (error) (+33 more)

### Community 4 - "Tab Terms & Getters"
Cohesion: 0.12
Nodes (32): Dependencies: OpenZeppelin Contracts v5.7.0 (Clones, ECDSA, IERC1271), forge-std v1.16.2, pinned submodules, Tab.agent(), isValidSignature check: address(this) == SELF -> REFUSED, terms check: address(this) == SELF -> revert NotATab, Tab.EIP712_DOMAIN_TYPEHASH (constant), Tab.expiry(), Tab._isPayee(), Tab.MAGIC (constant, ERC-1271 magic value) (+24 more)

### Community 5 - "USDC Interface & Close"
Cohesion: 0.14
Nodes (24): Arc quirk: fuzzer's random senders rejected with 'Blocked address'; suites pin one targetSender, IUSDC (interface), IUSDC.balanceOf() [external USDC call], IUSDC.transfer() [external USDC call], Tab.balance(), close check: msg.sender != owner -> revert NotOwner, Tab.close(), Tab.Closed (event) (+16 more)

### Community 6 - "Invariant Ghosts & Donations"
Cohesion: 0.17
Nodes (19): Arc quirk: a transfer that would empty a fresh account reverts ('Cannot clear balance of empty account'), Handler.someoneDonates(), Handler.donated (ghost), Handler.donationAttempts (ghost), Handler.paidToPayees (ghost), Handler.sweptToOwner (ghost), TabInvariantWithDonationsTest.invariant_agent_never_moves_more_than_was_put_in(), TabInvariantTest.invariant_balance_never_exceeds_the_cap() (+11 more)

### Community 7 - "Real USDC Test Interface"
Cohesion: 0.22
Nodes (11): Handler.USDC (constant), SanityTest.test_usdc_is_the_real_thing(), Base.sol (test utils), IUSDCFull (interface: Arc's real USDC as the tests drive it), IUSDCFull.allowance(), IUSDCFull.authorizationState(), IUSDCFull.decimals(), IUSDCFull.name() (+3 more)

### Community 8 - "Mutation Script Imports"
Cohesion: 0.33
Nodes (5): Removes each security check from src/Tab.sol in turn and runs the suite. A…, pathlib, re, subprocess, sys

## Knowledge Gaps
- **13 isolated node(s):** `install-arc-foundry.sh script`, `Clones.predictDeterministicAddressWithImmutableArgs() [OpenZeppelin]`, `Base.CAP (constant)`, `Base.MAX_PER_CALL (constant)`, `Base.Auth (struct)` (+8 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 20 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SECURITY.md (phase 1: contracts)` connect `Tooling, Arc Foundry & Docs` to `isValidSignature & Signing Helpers`, `Security Checks & Mutation Coverage`, `TabFactory & Opening`, `Tab Terms & Getters`, `USDC Interface & Close`, `Invariant Ghosts & Donations`?**
  _High betweenness centrality (0.178) - this node is a cross-community bridge._
- **Why does `Tab.isValidSignature()` connect `isValidSignature & Signing Helpers` to `Tooling, Arc Foundry & Docs`, `Security Checks & Mutation Coverage`, `Tab Terms & Getters`?**
  _High betweenness centrality (0.141) - this node is a cross-community bridge._
- **Why does `Handler (invariant handler contract)` connect `Security Checks & Mutation Coverage` to `isValidSignature & Signing Helpers`, `Tooling, Arc Foundry & Docs`, `Tab Terms & Getters`, `USDC Interface & Close`, `Invariant Ghosts & Donations`, `Real USDC Test Interface`?**
  _High betweenness centrality (0.118) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `Tab.isValidSignature()` (e.g. with `IERC1271 (interface) [OpenZeppelin]` and `Handler._judge()`) actually correct?**
  _`Tab.isValidSignature()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `install-arc-foundry.sh script`, `Clones.predictDeterministicAddressWithImmutableArgs() [OpenZeppelin]`, `Base.CAP (constant)` to the rest of the system?**
  _13 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `isValidSignature & Signing Helpers` be split into smaller, more focused modules?**
  _Cohesion score 0.10957501280081926 - nodes in this community are weakly interconnected._
- **Should `Tooling, Arc Foundry & Docs` be split into smaller, more focused modules?**
  _Cohesion score 0.06207482993197279 - nodes in this community are weakly interconnected._