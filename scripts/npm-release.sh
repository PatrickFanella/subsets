#!/usr/bin/env bash
# Publish one packed tarball to the Gitea npm registry and public npm.
# Usage: npm-release.sh check|publish TARBALL
# NPM_TOKEN is required. Without GITEA_NPM_TOKEN the Gitea registry is skipped.
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
  echo "//registry.npmjs.org/:_authToken=\${NPM_TOKEN}"
} > "$rc"
export NPM_CONFIG_USERCONFIG="$rc" NPM_TOKEN="${NPM_TOKEN:-}" GITEA_NPM_TOKEN="${GITEA_NPM_TOKEN:-}"
trap 'rm -f "$rc"' EXIT

published() { npm view "$name@$version" version --registry "$1" >/dev/null 2>&1; }

for registry in "$gitea" "$public"; do
  label=gitea; [ "$registry" = "$public" ] && label=npm
  if [ "$label" = gitea ] && [ -z "$GITEA_NPM_TOKEN" ]; then
    echo "gitea: GITEA_NPM_TOKEN is not set; skipping the Gitea registry"; continue
  fi
  if [ "$label" = npm ] && [ -z "$NPM_TOKEN" ]; then
    echo "::error::NPM_TOKEN is not set; public npm cannot be published"; exit 1
  fi
  if [ "$mode" = check ]; then
    who="$(npm whoami --registry "$registry")"
    echo "$label: authenticated as $who"
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
