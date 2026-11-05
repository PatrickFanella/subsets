#!/usr/bin/env bash
# Forced command for the Subsets release key on Almaz. The key's
# authorized_keys entry is:
#   restrict,from="10.0.0.50",command="$HOME/.local/bin/subsets-release-ssh" ssh-ed25519 ...
# It accepts only:
#   receive REVISION   load the landing image from stdin and check its label
#   deploy REVISION    run that image as subsets-landing, verify, or roll back
#   receive-main / deploy-main REVISION additionally require current main
#   status             print the running image and revision
set -euo pipefail
umask 077
tools="$HOME/.local/share/subsets/release-tools"
releases="$HOME/.local/share/subsets/releases"
url="https://subsets.subcult.tv/"
read -r -a args <<< "${SSH_ORIGINAL_COMMAND:-}"
cmd="${args[0]:-}" rev="${args[1]:-}"
current_main_only=false
case "$cmd" in receive-main|deploy-main) current_main_only=true; cmd="${cmd%-main}" ;; esac
# Keep automatic landing images separate from tagged package-release images.
image="subsets-landing:${rev:0:12}"
if [ "$current_main_only" = true ]; then image="subsets-landing-main:$rev"; fi
valid() { [[ "${#args[@]}" = 2 && "$rev" =~ ^[0-9a-f]{40}$ ]] || { echo "A full commit revision is required" >&2; exit 2; }; }
require_current_main() {
  if [ "$current_main_only" = true ]; then
    local current
    current="$(GIT_TERMINAL_PROMPT=0 git ls-remote --exit-code https://git.subcult.tv/subculture-collective/subsets.git refs/heads/main)"
    current="${current%%[[:space:]]*}"
    [ "$current" = "$rev" ] || { echo "Revision is not current main; use the newer CI run" >&2; exit 1; }
  fi
}
mkdir -p "$releases"
exec 9>"$releases/.deploy.lock"
flock -n 9 || { echo "Another Subsets landing operation is active" >&2; exit 1; }
running() { docker inspect -f '{{.Config.Image}}' subsets-landing 2>/dev/null || true; }
label() { docker image inspect -f '{{index .Config.Labels "tv.subcult.source-revision"}}' "$1"; }
up() { SUBSETS_IMAGE="$1" SUBSETS_REVISION="$2" docker compose -p subsets -f "$tools/compose.yml" up -d --wait --wait-timeout 60 subsets-landing; }
case "$cmd" in
  receive)
    valid
    require_current_main
    docker load -q
    [ "$(label "$image")" = "$rev" ] || { echo "Image $image does not carry revision $rev" >&2; exit 1; }
    echo "received $image"
    ;;
  deploy)
    valid
    require_current_main
    previous="$(running)"
    previous_id="$(docker inspect -f '{{.Image}}' subsets-landing 2>/dev/null || true)"
    previous_rev="$(docker inspect -f '{{index .Config.Labels "tv.subcult.source-revision"}}' subsets-landing 2>/dev/null || true)"
    [ "$(label "$image")" = "$rev" ] || { echo "Receive $image first" >&2; exit 1; }
    if [ "$current_main_only" != true ] && [ "$previous" = "$image" ]; then echo "$image is already live"; exit 0; fi
    dir="$releases/${rev:0:12}"; mkdir -p "$dir"
    printf '{"image":"%s","revision":"%s","previousImage":"%s","previousImageId":"%s","previousRevision":"%s","started":"%s"}\n' \
      "$image" "$rev" "$previous" "$previous_id" "$previous_rev" "$(date -u +%FT%TZ)" > "$dir/receipt.json"
    expected="$(docker run --rm --entrypoint cat "$image" /usr/share/nginx/html/index.html | sha256sum | cut -d' ' -f1)"
    require_current_main
    if up "$image" "$rev" && sleep 2 && [ "$(curl -fsS --retry 4 --retry-all-errors --max-time 30 "$url" | sha256sum | cut -d' ' -f1)" = "$expected" ]; then
      echo "deployed $image; $url serves its index.html"
      echo '{"result":"deployed"}' > "$dir/result.json"
    else
      echo "Verification failed; restoring $previous" >&2
      [ -n "$previous_id" ] && up "$previous_id" "${previous_rev:-unknown}"
      echo '{"result":"rolled-back"}' > "$dir/result.json"
      exit 1
    fi
    ;;
  status)
    [ "${#args[@]}" = 1 ] || { echo "status takes no arguments" >&2; exit 2; }
    echo "image=$(running) revision=$(docker inspect -f '{{index .Config.Labels "tv.subcult.source-revision"}}' subsets-landing 2>/dev/null)"
    ;;
  *) echo "Allowed: receive REVISION | deploy REVISION | receive-main REVISION | deploy-main REVISION | status" >&2; exit 2 ;;
esac
