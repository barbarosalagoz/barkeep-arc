#!/usr/bin/env python3
"""
Removes each security check from src/Tab.sol and src/TabFactory.sol in turn and
runs the suite. A
mutant that survives -- every test still passing -- means a check nothing tests.

    python3 script/mutation-check.py [fork-url]      default http://127.0.0.1:8555

Not mutation testing in general, only the checks that matter: one mutant per
line of the security spec. The sources are restored afterwards, pass or fail.
"""
import re, subprocess, sys
from pathlib import Path

FORK = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8555"
SRC = Path(__file__).resolve().parent.parent / "src"
TAB, FACTORY = SRC / "Tab.sol", SRC / "TabFactory.sol"
ORIGINALS = {TAB: TAB.read_text(), FACTORY: FACTORY.read_text()}

MUTANTS = [
    ("implementation may act as a tab", "        if (address(this) == SELF) return REFUSED;\n", ""),
    ("closed tab still signs", "        if (closed) return REFUSED;\n", ""),
    ("any length accepted", "        if (signature.length != SIGNATURE_LENGTH) return REFUSED;\n", ""),
    ("hash not tied to the fields", "        if (hash != _transferDigest(to, value, validAfter, validBefore, nonce)) return REFUSED;\n", ""),
    ("any signer accepted", "err != ECDSA.RecoverError.NoError || recovered != t.agent", "err != ECDSA.RecoverError.NoError"),
    ("spend after expiry", "        if (block.timestamp > t.expiry) return REFUSED;\n", ""),
    ("authorization may outlive the tab", "        if (validBefore > t.expiry) return REFUSED;\n", ""),
    ("no per-call maximum", "        if (value > t.maxPerCall) return REFUSED;\n", ""),
    ("any payee", "        if (!_isPayee(t.payees, to)) return REFUSED;\n", ""),
    ("anyone can close", "        if (msg.sender != t.owner) revert NotOwner();\n", ""),
    ("close does not mark closed", "        closed = true;\n", ""),
    ("close keeps the money", "        try USDC.transfer(t.owner, amount) returns (bool ok) {", "        try USDC.transfer(t.owner, 0) returns (bool ok) {"),
    ("a failed sweep undoes the close", "        } catch {}\n", "        } catch {\n            revert NotOwner();\n        }\n"),
    ("close reports swept when it was not", "            swept = ok;\n", "            swept = true;\n"),
    ("digest names the wrong sender", "abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, address(this), to,", "abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, SELF, to,"),
]

FACTORY_MUTANTS = [
    ("factory: zero agent allowed", "        if (agent == address(0)) revert ZeroAgent();\n", ""),
    ("factory: any number of payees", "        if (payees.length == 0 || payees.length > MAX_PAYEES) revert BadPayeeCount();\n", ""),
    ("factory: zero payee allowed", "            if (payees[i] == address(0)) revert ZeroPayee();\n", ""),
    ("factory: zero cap allowed", "        if (cap == 0) revert ZeroCap();\n", ""),
    ("factory: zero maximum allowed", "        if (maxPerCall == 0) revert ZeroMaxPerCall();\n", ""),
    ("factory: maximum above cap allowed", "        if (maxPerCall > cap) revert MaxPerCallAboveCap();\n", ""),
    ("factory: expiry in the past allowed", "        if (expiry <= block.timestamp) revert ExpiryNotInFuture();\n", ""),
    ("factory: failed funding ignored", "        if (!USDC.transferFrom(msg.sender, tab, cap)) revert FundingFailed();\n", "        USDC.transferFrom(msg.sender, tab, cap);\n"),
    ("factory: tab left unfunded", "        if (!USDC.transferFrom(msg.sender, tab, cap)) revert FundingFailed();\n", ""),
    ("factory: owner is not the caller", "_terms(msg.sender, agent, payees, maxPerCall, expiry), salt", "_terms(agent, agent, payees, maxPerCall, expiry), salt"),
]
ALL = [(TAB, *m) for m in MUTANTS] + [(FACTORY, *m) for m in FACTORY_MUTANTS]

def run_suite():
    run = subprocess.run(["arc-forge", "test", "--fork-url", FORK], capture_output=True, text=True)
    out = run.stdout + run.stderr
    failed = sorted(
        set(re.findall(r"^\[FAIL[^\n]*?\] (\w+)\(", out, re.M)) | set(re.findall(r"^\s+(invariant_\w+)\(\) \(runs", out, re.M))
    )
    passed = re.search(r"(\d+) tests passed, 0 failed", out)
    return run.returncode, out, failed, int(passed.group(1)) if passed else 0


# A kill only means something if the untouched suite passes here, against this fork URL. Without this, a dead
# arc-anvil or a bad RPC makes every mutant look killed.
code, out, failed, passed = run_suite()
if code != 0 or passed == 0:
    print(f"baseline is not green against {FORK} (exit {code}, {passed} passed, failing: {failed}); nothing was mutated")
    print(out[-1500:])
    sys.exit(2)
print(f"baseline  {passed} tests pass against {FORK}")

survivors, inconclusive = [], []
try:
    for path, name, old, new in ALL:
        assert ORIGINALS[path].count(old) == 1, f"mutant '{name}' no longer matches {path.name} exactly once"
        path.write_text(ORIGINALS[path].replace(old, new))
        code, out, failed, _ = run_suite()
        if code == 0:
            survivors.append(name)
            print(f"SURVIVED  {name}")
        elif failed:
            print(f"killed    {name}: {len(failed)} failing, e.g. {', '.join(failed[:3])}")
        else:
            # Non-zero exit with no failing test named: a compile error, a dead node, an RPC hiccup. Not a kill.
            inconclusive.append(name)
            print(f"UNCLEAR   {name}: suite exited {code} without naming a failing test")
        path.write_text(ORIGINALS[path])
finally:
    for path, text in ORIGINALS.items():
        path.write_text(text)

print(f"\n{len(ALL) - len(survivors) - len(inconclusive)}/{len(ALL)} mutants killed, {len(survivors)} survived, {len(inconclusive)} unclear")
sys.exit(1 if survivors or inconclusive else 0)
