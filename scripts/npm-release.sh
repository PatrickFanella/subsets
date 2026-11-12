#!/usr/bin/env bash
# Publish one packed tarball to the Gitea npm registry and public npm.
# Usage: npm-release.sh check|publish TARBALL
# Public npm uses NPM_TOKEN when set. Without it, the script must run in a GitHub
# Actions job with id-token: write, and npm publishes through trusted publishing
# (OIDC). Without GITEA_NPM_TOKEN the Gitea registry is skipped.
# Tokens reach npm through an npmrc that names the environment variables,
# so they never appear on a command line or in the log.
set -euo pipefail
mode="$1" tarball="$2"
name="$(node -p 'require("./package.json").name')"
version="$(node -p 'require("./package.json").version')"
gitea="https://git.subcult.tv/api/packages/subculture-collective/npm/"
public="https://registry.npmjs.org/"
case "$version" in *-*) dist_tag="${version#*-}"; dist_tag="${dist_tag%%.*}" ;; *) dist_tag=latest ;; esac

rc="${RUNNER_TEMP:-/tmp}/release-npmrc"
umask 077
{
  echo "//git.subcult.tv/api/packages/subculture-collective/npm/:_authToken=\${GITEA_NPM_TOKEN}"
  # An empty token line would shadow the OIDC token npm fetches itself.
  [ -z "${NPM_TOKEN:-}" ] || echo "//registry.npmjs.org/:_authToken=\${NPM_TOKEN}"
} > "$rc"
export NPM_CONFIG_USERCONFIG="$rc" NPM_TOKEN="${NPM_TOKEN:-}" GITEA_NPM_TOKEN="${GITEA_NPM_TOKEN:-}"
trap 'rm -f "$rc"' EXIT

published() { npm view "$name@$version" version --registry "$1" >/dev/null 2>&1; }

for registry in "$gitea" "$public"; do
  label=gitea; [ "$registry" = "$public" ] && label=npm
  if [ "$label" = gitea ] && [ -z "$GITEA_NPM_TOKEN" ]; then
    echo "gitea: GITEA_NPM_TOKEN is not set; skipping the Gitea registry"; continue
  fi
  oidc=false
  if [ "$label" = npm ] && [ -z "$NPM_TOKEN" ]; then
    if [ -z "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ]; then
      echo "::error::Set NPM_TOKEN, or run in GitHub Actions with id-token: write for trusted publishing"; exit 1
    fi
    oidc=true
  fi
  if [ "$mode" = check ]; then
    if [ "$oidc" = true ]; then
      bash scripts/npm-oidc-check.sh "$name"
    else
      echo "$label: authenticated as $(npm whoami --registry "$registry")"
    fi
    published "$registry" && echo "$label: $name@$version already published" || echo "$label: $name@$version not yet published"
    continue
  fi
  if published "$registry"; then
    echo "$label: $name@$version already published; skipping"
  else
    npm publish "$tarball" --registry "$registry" --access public --tag "$dist_tag"
  fi
  integrity="$(npm view "$name@$version" dist.integrity --registry "$registry")"
  expected="sha512-$(openssl dgst -sha512 -binary "$tarball" | base64 -w0)"
  [ "$integrity" = "$expected" ] || { echo "::error::$label serves a different tarball for $version"; exit 1; }
  echo "$label: $name@$version read back with the packed integrity"
done
