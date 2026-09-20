#!/usr/bin/env bash
# Installs a pinned, checksummed Arc Foundry as arc-forge / arc-cast / arc-anvil.
# https://github.com/circlefin/arc-foundry -- it is not available through foundryup.
set -euo pipefail

# The macOS build links libusb dynamically; make sure the Linux one finds it too.
sudo apt-get update -qq && sudo apt-get install -y -qq libusb-1.0-0 >/dev/null

version="${ARC_FOUNDRY_VERSION:?}"
expected="${ARC_FOUNDRY_SHA256:?}"
archive="arc-foundry-${version}-x86_64-unknown-linux-gnu.tar.gz"

curl -fsSL -o "/tmp/${archive}" "https://github.com/circlefin/arc-foundry/releases/download/${version}/${archive}"
echo "${expected}  /tmp/${archive}" | sha256sum -c -

mkdir -p "$HOME/.local/bin" /tmp/arc-foundry
tar -xzf "/tmp/${archive}" -C /tmp/arc-foundry
for tool in forge cast anvil; do
  install -m 0755 "/tmp/arc-foundry/${tool}" "$HOME/.local/bin/arc-${tool}"
done
echo "$HOME/.local/bin" >> "$GITHUB_PATH"
"$HOME/.local/bin/arc-forge" --version
