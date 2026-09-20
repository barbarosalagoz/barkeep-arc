# Graph Report - barkeep-arc  (2026-09-20)

## Corpus Check
- Corpus is ~6,138 words - fits in a single context window. You may not need a graph.

## Summary
- 324 nodes · 1105 edges · 8 communities
- Extraction: 84% EXTRACTED · 16% INFERRED · 0% AMBIGUOUS · INFERRED: 175 edges (avg confidence: 0.92)
- Token cost: 137,257 input · 0 output

## Community Hubs (Navigation)
- isValidSignature Checks & Refuse Tests
- Invariant Handler & Ghosts
- TabFactory & Opening Checks
- SECURITY.md: Review & Design
- Tooling, Arc Foundry & Arc Quirks
- Tab Terms, Getters & USDC Interface
- close() & Revocation
- Test Base & Real USDC Interface

## God Nodes (most connected - your core abstractions)
1. `Tab.isValidSignature()` - 68 edges
2. `SECURITY.md (phase 1: contracts)` - 51 edges
3. `Handler (invariant handler contract)` - 40 edges
4. `Base._auth()` - 37 edges
5. `Base._sign()` - 34 edges
6. `Tab (contract)` - 32 edges
7. `TabFactory.openTab()` - 31 edges
8. `Tab.close()` - 29 edges
9. `Base (abstract test contract)` - 28 edges
10. `IUSDCFull.balanceOf()` - 27 edges

## Surprising Connections (you probably didn't know these)
- `script/mutation-check.py: needs a green baseline, removes each check in turn, 25 of 25 mutants must die` --semantically_similar_to--> `Mutation check: each check in Tab.sol and each validation in TabFactory.sol is deleted in turn; 25 of 25 mutants die; needs a green baseline and a named failing test`  [INFERRED] [semantically similar]
  contracts/README.md → docs/SECURITY.md
- `ARC_FOUNDRY_VERSION v0.8.0-1 pinned and SHA-256 checksummed` --semantically_similar_to--> `Arc Foundry (arc-forge / arc-cast / arc-anvil v0.8.0-1), not upstream Foundry`  [INFERRED] [semantically similar]
  .github/workflows/ci.yml → contracts/README.md
- `Non-promise: a listed payee can be the agent itself; the contract does not second-guess the list` --references--> `isValidSignature check: to not in payees -> REFUSED`  [INFERRED]
  docs/SECURITY.md → contracts/src/Tab.sol
- `Design: the factory does not reject every odd set of terms (duplicate payees, tab as payee, owner == agent, contract agent)` --rationale_for--> `TabFactory.openTab()`  [INFERRED]
  docs/SECURITY.md → contracts/src/TabFactory.sol
- `No cumulative counter, on purpose (EIP-3009 nonce burn + digest names the tab as from)` --semantically_similar_to--> `The balance is the limit (one clone per tab, funded with exactly the cap)`  [INFERRED] [semantically similar]
  docs/SECURITY.md → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **The nine refusal checks of Tab.isValidSignature** — contracts_src_tab_check_not_implementation, contracts_src_tab_check_not_closed, contracts_src_tab_check_signature_length, contracts_src_tab_check_hash_matches_transfer_digest, contracts_src_tab_check_signer_is_agent, contracts_src_tab_check_not_expired, contracts_src_tab_check_validbefore_within_expiry, contracts_src_tab_check_value_within_maxpercall, contracts_src_tab_check_to_is_payee [EXTRACTED 1.00]
- **The eight validations of TabFactory.openTab** — contracts_src_tabfactory_check_agent_nonzero, contracts_src_tabfactory_check_payee_count, contracts_src_tabfactory_check_payee_nonzero, contracts_src_tabfactory_check_cap_nonzero, contracts_src_tabfactory_check_maxpercall_nonzero, contracts_src_tabfactory_check_maxpercall_within_cap, contracts_src_tabfactory_check_expiry_in_future, contracts_src_tabfactory_check_funding_succeeded [EXTRACTED 1.00]
- **Revocation does not depend on the sweep: close(), its design note, review finding and tests** — contracts_src_tab_close, docs_security_design_close_ordering, docs_security_review_close_revocation, contracts_test_tab_close_t_test_close_revokes_the_agent_even_when_usdc_refuses_the_sweep, contracts_test_tab_close_t_test_a_false_return_from_usdc_still_closes_and_reports_not_swept [INFERRED 0.95]
- **Settlement flow: relayer -> USDC.transferWithAuthorization -> Tab.isValidSignature -> digest rebuild + ECDSA recover** — contracts_test_utils_base_settle, contracts_test_utils_base_iusdcfull_transferwithauthorization_bytes, contracts_src_tab_isvalidsignature, contracts_src_tab_transferdigest, openzeppelin_ecdsa_tryrecovercalldata, contracts_src_tab_ispayee [INFERRED 0.95]

## Communities (8 total, 0 thin omitted)

### Community 0 - "isValidSignature Checks & Refuse Tests"
Cohesion: 0.12
Nodes (72): isValidSignature check: hash != rebuilt transfer digest -> REFUSED, isValidSignature check: block.timestamp > expiry -> REFUSED, isValidSignature check: signature.length != 213 -> REFUSED, isValidSignature check: ECDSA recover error or signer != agent -> REFUSED, isValidSignature check: to not in payees -> REFUSED, isValidSignature check: validBefore > expiry -> REFUSED, isValidSignature check: value > maxPerCall -> REFUSED, Tab._isPayee() (+64 more)

### Community 1 - "Invariant Handler & Ghosts"
Cohesion: 0.08
Nodes (53): Arc quirk: a transfer that would empty a fresh account reverts ('Cannot clear balance of empty account'), Handler.agentPaysAboveMax(), Handler.agentPaysOutsider(), Handler.agentPaysPayee(), Handler._attempt(), Handler.Attempt (struct), Handler.constructor(), Handler (invariant handler contract) (+45 more)

### Community 2 - "TabFactory & Opening Checks"
Cohesion: 0.12
Nodes (49): IUSDC.transferFrom() [external USDC call], MAX_PAYEES (file-level constant = 20), TabFactory.BadPayeeCount (error), openTab check: agent == address(0) -> revert ZeroAgent, openTab check: cap == 0 -> revert ZeroCap, openTab check: expiry <= block.timestamp -> revert ExpiryNotInFuture, openTab check: USDC.transferFrom returned false -> revert FundingFailed, openTab check: maxPerCall == 0 -> revert ZeroMaxPerCall (+41 more)

### Community 3 - "SECURITY.md: Review & Design"
Cohesion: 0.08
Nodes (38): slither.config.json fails on medium and above; one inline suppression, SECURITY.md (phase 1: contracts), Independent adversarial code review of commit 881fcc7: no way for a non-owner to move money or the agent to exceed the terms; three findings fixed, Design: the factory does not reject every odd set of terms (duplicate payees, tab as payee, owner == agent, contract agent), Design: no assembly in src/ (only inside OpenZeppelin Clones and ECDSA), Non-promise: isValidSignature is a view, so it cannot rate-limit; a leaked agent key can drain the tab to the payees, Keys: phase 2 must keep the owner key away from the process holding the agent key (Stellar's bin/barkeep-mcp read both), Mutation check: each check in Tab.sol and each validation in TabFactory.sol is deleted in turn; 25 of 25 mutants die; needs a green baseline and a named failing test (+30 more)

### Community 4 - "Tooling, Arc Foundry & Arc Quirks"
Cohesion: 0.07
Nodes (25): Contracts README, arc-anvil --network arc deploys Arc's system contracts; tests fork from it (71 tests), Arc Foundry (arc-forge / arc-cast / arc-anvil v0.8.0-1), not upstream Foundry, Arc quirk: fuzzer's random senders rejected with 'Blocked address'; suites pin one targetSender, Arc quirk: native balance (18 decimals) and USDC ERC-20 view (6 decimals) are one balance; vm.deal funds USDC, script/mutation-check.py: needs a green baseline, removes each check in turn, 25 of 25 mutants must die, Removes each security check from src/Tab.sol and src/TabFactory.sol in turn and…, SanityTest (test contract) (+17 more)

### Community 5 - "Tab Terms, Getters & USDC Interface"
Cohesion: 0.11
Nodes (34): Dependencies: OpenZeppelin Contracts v5.7.0 (Clones, ECDSA, IERC1271), forge-std v1.16.2, pinned submodules, IUSDC (interface), IUSDC.balanceOf() [external USDC call], Tab.agent(), Tab.balance(), isValidSignature check: address(this) == SELF -> REFUSED, terms check: address(this) == SELF -> revert NotATab, Tab.EIP712_DOMAIN_TYPEHASH (constant) (+26 more)

### Community 6 - "close() & Revocation"
Cohesion: 0.21
Nodes (23): IUSDC.transfer() [external USDC call], close check: msg.sender != owner -> revert NotOwner, isValidSignature check: closed -> REFUSED, Tab.close(), Tab.Closed (event: owner, amount, swept), Tab.closed (only storage variable), Tab.NotOwner (error), Handler.ownerCloses() (+15 more)

### Community 7 - "Test Base & Real USDC Interface"
Cohesion: 0.15
Nodes (16): Handler.USDC (constant), SanityTest.test_usdc_is_the_real_thing(), Base.sol (test utils), Base.Auth (struct), Base (abstract test contract), Base.CANCEL_TYPEHASH (constant), IUSDCFull (interface: Arc's real USDC as the tests drive it), IUSDCFull.allowance() (+8 more)

## Knowledge Gaps
- **4 isolated node(s):** `install-arc-foundry.sh script`, `Handler.owner (immutable)`, `Unaudited: reviewed only by the author and the listed tools`, `Base.Auth (struct)`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 9 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SECURITY.md (phase 1: contracts)` connect `SECURITY.md: Review & Design` to `isValidSignature Checks & Refuse Tests`, `Invariant Handler & Ghosts`, `TabFactory & Opening Checks`, `Tooling, Arc Foundry & Arc Quirks`, `Tab Terms, Getters & USDC Interface`, `close() & Revocation`?**
  _High betweenness centrality (0.200) - this node is a cross-community bridge._
- **Why does `Tab.isValidSignature()` connect `isValidSignature Checks & Refuse Tests` to `Invariant Handler & Ghosts`, `TabFactory & Opening Checks`, `SECURITY.md: Review & Design`, `Tab Terms, Getters & USDC Interface`, `close() & Revocation`?**
  _High betweenness centrality (0.177) - this node is a cross-community bridge._
- **Why does `Handler (invariant handler contract)` connect `Invariant Handler & Ghosts` to `isValidSignature Checks & Refuse Tests`, `Tab Terms, Getters & USDC Interface`, `close() & Revocation`, `Test Base & Real USDC Interface`?**
  _High betweenness centrality (0.098) - this node is a cross-community bridge._
- **Are the 25 inferred relationships involving `Tab.isValidSignature()` (e.g. with `Handler._judge()` and `TabInvariantBase.invariant_no_attempt_ever_contradicts_the_model()`) actually correct?**
  _`Tab.isValidSignature()` has 25 INFERRED edges - model-reasoned connections that need verification._
- **What connects `install-arc-foundry.sh script`, `Handler.owner (immutable)`, `Unaudited: reviewed only by the author and the listed tools` to the rest of the system?**
  _4 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `isValidSignature Checks & Refuse Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.11737089201877934 - nodes in this community are weakly interconnected._
- **Should `Invariant Handler & Ghosts` be split into smaller, more focused modules?**
  _Cohesion score 0.08215488215488216 - nodes in this community are weakly interconnected._