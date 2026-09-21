# Graph Report - barkeep-arc  (2026-09-21)

## Corpus Check
- Corpus is ~28,005 words - fits in a single context window. You may not need a graph.

## Summary
- 619 nodes · 1717 edges · 22 communities (18 shown, 4 thin omitted)
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 246 edges (avg confidence: 0.89)
- Token cost: 87,754 input · 0 output

## Community Hubs (Navigation)
- close(), Revocation & Arc Quirks
- MCP Tools, Known Limits & Deviations
- USDC Interface & Test Interface
- isValidSignature Checks & Refuse Tests
- Tooling, Arc Foundry & Mutation Check
- TabFactory & Opening Checks
- Sanity Tests & Native Balance
- MCP Package Manifest
- Test Helpers & Pay Tests
- Tab Terms & Getters
- ABIs & Chain Adapter
- Testnet Done-tests Script
- Demo Seller & Circle Client
- TypeScript Config
- Root Package Manifest
- Owner Key File & CLI
- Agent Keys & Forced Signing
- State Store
- Agent Key & Boundary Tests
- Arc Foundry Installer
- MCP Launcher
- Owner Launcher

## God Nodes (most connected - your core abstractions)
1. `Tab.isValidSignature()` - 73 edges
2. `Handler (invariant handler contract)` - 38 edges
3. `Base._auth()` - 36 edges
4. `Tab (contract)` - 34 edges
5. `TabFactory.openTab()` - 34 edges
6. `Base._sign()` - 33 edges
7. `Tab.close()` - 28 edges
8. `Base (abstract test contract)` - 28 edges
9. `TabRefuseTest (test contract)` - 26 edges
10. `AgentKeys` - 25 edges

## Surprising Connections (you probably didn't know these)
- `The keys are the biggest problem (separation by process, not OS)` --references--> `AgentKeys`  [INFERRED]
  docs/SECURITY.md → packages/mcp-server/src/agentKeys.ts
- `Done-test A5: owner closes, agent tries again` --references--> `AgentKeys`  [INFERRED]
  docs/TESTNET.md → packages/mcp-server/src/agentKeys.ts
- `deployFactory()` --implements--> `TabFactory on Arc Testnet at 0xd7c3e010...ba9ed`  [INFERRED]
  packages/mcp-server/src/owner/actions.ts → docs/TESTNET.md
- `Done-test A1: open, fund, agent pays an allowlisted payee, tab_status shows the drop` --references--> `openTab()`  [INFERRED]
  docs/TESTNET.md → packages/mcp-server/src/owner/actions.ts
- `Done-test A4: after expiry` --references--> `closeTab()`  [INFERRED]
  docs/TESTNET.md → packages/mcp-server/src/owner/actions.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Testnet done-tests A1 to A8** — docs_testnet_a1, docs_testnet_a2, docs_testnet_a3, docs_testnet_a4, docs_testnet_a5, docs_testnet_a6, docs_testnet_a7, docs_testnet_a8, docs_testnet_done_tests_script, docs_testnet_deployment_record [EXTRACTED 1.00]
- **Clock skew: cause, symptom, guard, proof** — docs_findings_08_x402_client_validbefore_local_clock_stock_client_validbefore_from_date_now, docs_findings_08_x402_client_validbefore_local_clock_facilitator_opaque_refusal, docs_findings_08_x402_client_validbefore_local_clock_max_clock_skew_guard, packages_mcp_server_src_x402sign_createsigner, docs_testnet_a8, docs_findings_08_x402_client_validbefore_local_clock_snapshot_and_guard_in_int_test [INFERRED 0.95]
- **Agent-key server vs owner-key CLI boundary** — packages_mcp_server_readme_two_programs_two_keys, packages_mcp_server_readme_boundary_test, packages_mcp_server_src_agentkeys_agentkeys, packages_mcp_server_src_owner_keyfile_owneraccount, packages_mcp_server_src_index_createserver, github_workflows_ci_job_mcp_server, docs_security_keys_biggest_problem [INFERRED 0.95]
- **The nine refusal checks of Tab.isValidSignature** — contracts_src_tab_check_not_implementation, contracts_src_tab_check_not_closed, contracts_src_tab_check_signature_length, contracts_src_tab_check_hash_matches_transfer_digest, contracts_src_tab_check_signer_is_agent, contracts_src_tab_check_not_expired, contracts_src_tab_check_validbefore_within_expiry, contracts_src_tab_check_value_within_maxpercall, contracts_src_tab_check_to_is_payee [EXTRACTED 1.00]
- **The eight validations of TabFactory.openTab** — contracts_src_tabfactory_check_agent_nonzero, contracts_src_tabfactory_check_payee_count, contracts_src_tabfactory_check_payee_nonzero, contracts_src_tabfactory_check_cap_nonzero, contracts_src_tabfactory_check_maxpercall_nonzero, contracts_src_tabfactory_check_maxpercall_within_cap, contracts_src_tabfactory_check_expiry_in_future, contracts_src_tabfactory_check_funding_succeeded [EXTRACTED 1.00]

## Communities (22 total, 4 thin omitted)

### Community 0 - "close(), Revocation & Arc Quirks"
Cohesion: 0.07
Nodes (64): Arc quirk: fuzzer's random senders rejected with 'Blocked address'; suites pin one targetSender, Arc quirk: a transfer that would empty a fresh account reverts ('Cannot clear balance of empty account'), close check: msg.sender != owner -> revert NotOwner, isValidSignature check: closed -> REFUSED, Tab.close(), Tab.Closed (event: owner, amount, swept), Tab.closed (only storage variable), Tab.NotOwner (error) (+56 more)

### Community 1 - "MCP Tools, Known Limits & Deviations"
Cohesion: 0.08
Nodes (51): Known limit: tabs not opened by the factory carry no guarantees, Known limit: cannot pay a Circle Gateway batched option (ecrecover only), Spec deviation: open_tab does not deploy and close_tab does not sweep, MCP tool close_tab, MCP tool open_tab, MCP tool pay_and_fetch, MCP tool tab_status, readBack() (+43 more)

### Community 2 - "USDC Interface & Test Interface"
Cohesion: 0.07
Nodes (61): IUSDC (interface), IUSDC.balanceOf() [external USDC call], IUSDC.transfer() [external USDC call], IUSDC.transferFrom() [external USDC call], Finding 08: x402 client dates validBefore by the local clock, Advice: on simulation_failed with everything else right, compare your clock with the latest block timestamp, Asymmetric window: tolerates a clock 10 minutes fast but only maxTimeoutSeconds slow, A clock ahead makes the authorization outlive the seller's timeout and breaks the tab's validBefore <= expiry clamp (+53 more)

### Community 3 - "isValidSignature Checks & Refuse Tests"
Cohesion: 0.11
Nodes (59): isValidSignature check: hash != rebuilt transfer digest -> REFUSED, isValidSignature check: block.timestamp > expiry -> REFUSED, isValidSignature check: signature.length != 213 -> REFUSED, isValidSignature check: ECDSA recover error or signer != agent -> REFUSED, isValidSignature check: to not in payees -> REFUSED, isValidSignature check: validBefore > expiry -> REFUSED, isValidSignature check: value > maxPerCall -> REFUSED, Tab._isPayee() (+51 more)

### Community 4 - "Tooling, Arc Foundry & Mutation Check"
Cohesion: 0.06
Nodes (41): Contracts README, arc-anvil --network arc deploys Arc's system contracts; tests fork from it (71 tests), Arc Foundry (arc-forge / arc-cast / arc-anvil v0.8.0-1), not upstream Foundry, script/mutation-check.py: needs a green baseline, removes each check in turn, 25 of 25 mutants must die, slither.config.json fails on medium and above; one inline suppression, Removes each security check from src/Tab.sol and src/TabFactory.sol in turn and…, Independent adversarial code review of commit 881fcc7, Decision: close() sets closed first, then try/catch sweep (+33 more)

### Community 5 - "TabFactory & Opening Checks"
Cohesion: 0.10
Nodes (41): MAX_PAYEES (file-level constant = 20), TabFactory.BadPayeeCount (error), openTab check: agent == address(0) -> revert ZeroAgent, openTab check: cap == 0 -> revert ZeroCap, openTab check: expiry <= block.timestamp -> revert ExpiryNotInFuture, openTab check: USDC.transferFrom returned false -> revert FundingFailed, openTab check: maxPerCall == 0 -> revert ZeroMaxPerCall, openTab check: maxPerCall > cap -> revert MaxPerCallAboveCap (+33 more)

### Community 6 - "Sanity Tests & Native Balance"
Cohesion: 0.07
Nodes (32): Arc quirk: native balance (18 decimals) and USDC ERC-20 view (6 decimals) are one balance; vm.deal funds USDC, SanityTest (test contract), SanityTest.test_native_balance_and_erc20_view_are_one_balance(), SanityTest.test_usdc_is_the_real_thing(), Base.sol (test utils), Base.Auth (struct), Base (abstract test contract), Base.CANCEL_TYPEHASH (constant) (+24 more)

### Community 7 - "MCP Package Manifest"
Cohesion: 0.07
Nodes (29): bin, barkeep-arc-mcp, barkeep-arc-owner, dependencies, @modelcontextprotocol/sdk, viem, @x402/core, @x402/evm (+21 more)

### Community 8 - "Test Helpers & Pay Tests"
Cohesion: 0.16
Nodes (23): TAB_SIGNATURE_BYTES, storedText(), challenge(), FACTORY, fakeChain(), NET, NOW, offer() (+15 more)

### Community 9 - "Tab Terms & Getters"
Cohesion: 0.15
Nodes (28): Dependencies: OpenZeppelin Contracts v5.7.0 (Clones, ECDSA, IERC1271), forge-std v1.16.2, pinned submodules, Tab.agent(), Tab.balance(), isValidSignature check: address(this) == SELF -> REFUSED, terms check: address(this) == SELF -> revert NotATab, Tab.EIP712_DOMAIN_TYPEHASH (constant), Tab.expiry(), Tab.MAGIC (constant, ERC-1271 magic value) (+20 more)

### Community 10 - "ABIs & Chain Adapter"
Cohesion: 0.15
Nodes (18): FACTORY_ABI, TAB_ABI, USDC_ABI, OnChainTab, deploymentFile(), closeTab(), deployFactory(), describeRequest() (+10 more)

### Community 11 - "Testnet Done-tests Script"
Cohesion: 0.10
Nodes (17): chain, client, done(), factory, file, keys, net, outsiderKey (+9 more)

### Community 12 - "Demo Seller & Circle Client"
Cohesion: 0.19
Nodes (13): CircleAnswer, DemoSeller, SellerLogEntry, make(), REPO_ROOT, USDC, USDC_DOMAIN, SignedPayment (+5 more)

### Community 13 - "TypeScript Config"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit (+9 more)

### Community 14 - "Root Package Manifest"
Cohesion: 0.15
Nodes (12): engines, node, license, name, private, scripts, test:int, test:unit (+4 more)

### Community 15 - "Owner Key File & CLI"
Cohesion: 0.23
Nodes (9): barkeep-arc-owner (owner's command line, human-run), NetworkName, DEFAULT_KEY_NAME, keysFile(), namedAccount(), ownerAccount(), PaymentRecord, Receipt (+1 more)

### Community 16 - "Agent Keys & Forced Signing"
Cohesion: 0.31
Nodes (5): forceSign(), AgentKeys, tabSigner(), createSigner(), setup()

### Community 18 - "Agent Key & Boundary Tests"
Cohesion: 0.31
Nodes (5): StoredAgentKey, SRC, ref_node_fs, ref_node_path, ref_node_url

## Knowledge Gaps
- **100 isolated node(s):** `install-arc-foundry.sh script`, `name`, `private`, `version`, `license` (+95 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 148 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Tab.isValidSignature()` connect `isValidSignature Checks & Refuse Tests` to `close(), Revocation & Arc Quirks`, `USDC Interface & Test Interface`, `Tooling, Arc Foundry & Mutation Check`, `TabFactory & Opening Checks`, `Tab Terms & Getters`?**
  _High betweenness centrality (0.217) - this node is a cross-community bridge._
- **Why does `TabFactory.openTab()` connect `TabFactory & Opening Checks` to `USDC Interface & Test Interface`, `isValidSignature Checks & Refuse Tests`, `Tooling, Arc Foundry & Mutation Check`, `Sanity Tests & Native Balance`, `Tab Terms & Getters`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._
- **Why does `Tab.close()` connect `close(), Revocation & Arc Quirks` to `Tab Terms & Getters`, `USDC Interface & Test Interface`, `Tooling, Arc Foundry & Mutation Check`, `TabFactory & Opening Checks`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Are the 30 inferred relationships involving `Tab.isValidSignature()` (e.g. with `What the contract promises (five guarantees)` and `Handler._judge()`) actually correct?**
  _`Tab.isValidSignature()` has 30 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `Tab (contract)` (e.g. with `Tab: one contract per tab, funded with exactly the cap` and `Known limit: the balance can exceed the cap (donations)`) actually correct?**
  _`Tab (contract)` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `TabFactory.openTab()` (e.g. with `Terms in clone bytecode (EIP-1167 immutable args, CREATE2)` and `TabFactoryTest.test_a_tab_is_funded_with_exactly_the_cap_and_the_factory_keeps_nothing()`) actually correct?**
  _`TabFactory.openTab()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **What connects `install-arc-foundry.sh script`, `name`, `private` to the rest of the system?**
  _100 weakly-connected nodes found - possible documentation gaps or missing edges._