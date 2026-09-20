#!/usr/bin/env python3
"""
Fails if anything that looks like a secret is, or ever was, in the repository.

    python3 .github/secret-scan.py              scan tracked files and every commit's added lines
    python3 .github/secret-scan.py --self-test  prove the patterns catch what they should and spare what they should

.gitignore is the control; this is the check that it is working. Keys live in
~/.local/state/barkeep-arc/, never here.

A private key and a transaction hash are both 32 bytes of hex, so hex alone
proves nothing. A line is flagged when 64 hex characters appear on it together
with a word that says "this is a key", unless the hex is plainly a hash: part of
an explorer URL, or one of the known constants below.
"""
import re
import subprocess
import sys

SECRET_FILES = re.compile(
    r"(^|/)\.env($|\.)|(^|/)keys\.json$|keystore|mnemonic|\.seed$|\.key$|\.pem$|\.p12$|id_rsa|id_ed25519", re.I
)
ALLOWED_FILES = re.compile(r"(^|/)\.env\.example$")

HEX64 = re.compile(r"(?<![0-9a-fA-F])(?:0x)?([0-9a-fA-F]{64})(?![0-9a-fA-F])")
KEYWORD = re.compile(r"key|\bpk\b|_pk\b|secret|mnemonic|seed|passphrase|password", re.I)
MNEMONIC = re.compile(r"(mnemonic|seed phrase|recovery phrase)\W+(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b", re.I)

# secp256k1's group order and its half: they appear next to the word "key" in the tests and are not keys.
KNOWN_CONSTANTS = {
    "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141",
    "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140",
    "7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0",
}


def line_is_suspect(line: str) -> bool:
    if MNEMONIC.search(line):
        return True
    if not KEYWORD.search(line):
        return False
    for match in HEX64.finditer(line):
        value = match.group(1).lower()
        if value in KNOWN_CONSTANTS:
            continue
        before = line[: match.start()]
        if re.search(r"/tx/$|/transaction/$|/block/$", before):
            continue
        return True
    return False


def git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True, errors="replace").stdout


def scan() -> int:
    problems = []

    ever_tracked = set(git("log", "--all", "--pretty=format:", "--name-only", "--diff-filter=A").split()) | set(
        git("ls-files").split()
    )
    for path in sorted(ever_tracked):
        if SECRET_FILES.search(path) and not ALLOWED_FILES.search(path):
            problems.append(f"secret-bearing file name in history or index: {path}")

    # Every line any commit ever added, plus the working index. Submodules are not part of `git log -p`.
    added = git("log", "--all", "-p", "--no-color", "--unified=0", "--no-ext-diff")
    current_file = "?"
    for line in added.splitlines():
        if line.startswith("+++ b/"):
            current_file = line[6:]
        elif line.startswith("+") and not line.startswith("+++"):
            if current_file.endswith("secret-scan.py"):
                continue  # the self-test samples below
            if line_is_suspect(line[1:]):
                problems.append(f"{current_file}: {line[1:121].strip()}")

    example = git("show", ":.env.example") if ".env.example" in git("ls-files").split() else ""
    if re.search(r"[0-9a-fA-F]{40,}", example):
        problems.append(".env.example contains a long hex value")

    for problem in sorted(set(problems)):
        print(f"::error::{problem}")
    print("OK - nothing secret-looking in the index or in history." if not problems else f"{len(set(problems))} problem(s)")
    return 1 if problems else 0


def self_test() -> int:
    k = "4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318"
    must_flag = [
        f"PRIVATE_KEY=0x{k}",
        f'"privateKey": "0x{k}"',
        f"AGENT_KEY=0x{k}",
        f"cast send --private-key 0x{k} 0xabc",
        f"uint256 agentKey = 0x{k};",
        f"DEPLOYER_PK={k}",
        f'const pk = "0x{k}"',
        f'"secretKey": "0x{k}"',
        "mnemonic: test test test test test test test test test test test junk",
    ]
    must_spare = [
        f"the keyless trial settled it: https://explorer.testnet.arc.io/tx/0x{k}",
        f"ARC_FOUNDRY_SHA256: {k}",
        f"bytes32 digest = 0x{k};",
        "key = bound(key, 1, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140);",
        "the agent key can only spend within the tab",
    ]
    files_flag = [".env", "contracts/.env", "contracts/.env.local", "keys.json", "deploy/keys.json", "a.pem", "id_ed25519"]
    files_spare = [".env.example", "contracts/src/Tab.sol", "docs/SECURITY.md"]

    bad = [s for s in must_flag if not line_is_suspect(s)] + [s for s in must_spare if line_is_suspect(s)]
    bad += [f for f in files_flag if not (SECRET_FILES.search(f) and not ALLOWED_FILES.search(f))]
    bad += [f for f in files_spare if SECRET_FILES.search(f) and not ALLOWED_FILES.search(f)]
    for item in bad:
        print(f"self-test wrong on: {item}")
    print(f"self-test: {len(must_flag) + len(must_spare) + len(files_flag) + len(files_spare) - len(bad)} of "
          f"{len(must_flag) + len(must_spare) + len(files_flag) + len(files_spare)} cases right")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv else scan())
