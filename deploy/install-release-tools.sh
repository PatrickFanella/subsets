#!/usr/bin/env bash
# Install the release receiver on Almaz from a checkout of the merged change.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tools="$HOME/.local/share/subsets/release-tools"
install -d -m 700 "$tools" "$HOME/.local/bin"
install -m 600 "$here/compose.yml" "$tools/compose.yml"
install -m 700 "$here/release-ssh.sh" "$HOME/.local/bin/subsets-release-ssh"
sha256sum "$tools/compose.yml" "$HOME/.local/bin/subsets-release-ssh"
