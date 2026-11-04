#!/usr/bin/env bash
# Forced command for the Subsets release key on Almaz. The key's
# authorized_keys entry is:
#   restrict,from="10.0.0.50",command="$HOME/.local/bin/subsets-release-ssh" ssh-ed25519 ...
# It accepts only:
#   receive REVISION   load the landing image from stdin and check its label
#   deploy REVISION    run that image as subsets-landing, verify, or roll back
#   status             print the running image and revision
set -euo pipefail
tools="$HOME/.local/share/subsets/release-tools"
releases="$HOME/.local/share/subsets/releases"
url="https://subsets.subcult.tv/"
read -r -a args <<< "${SSH_ORIGINAL_COMMAND:-}"
cmd="${args[0]:-}" rev="${args[1]:-}"
valid() { [[ "$rev" =~ ^[0-9a-f]{40}$ ]] || { echo "A full commit revision is required" >&2; exit 2; }; }
running() { docker inspect -f '{{.Config.Image}}' subsets-landing 2>/dev/null || true; }
label() { docker image inspect -f '{{index .Config.Labels "tv.subcult.source-revision"}}' "$1"; }
up() { SUBSETS_IMAGE="$1" SUBSETS_REVISION="$2" docker compose -p subsets -f "$tools/compose.yml" up -d --wait --wait-timeout 60 subsets-landing; }
case "$cmd" in
  receive)
    valid
    docker load -q
    image="subsets-landing:${rev:0:12}"
    [ "$(label "$image")" = "$rev" ] || { echo "Image $image does not carry revision $rev" >&2; exit 1; }
    echo "received $image"
    ;;
  deploy)
    valid
    image="subsets-landing:${rev:0:12}" previous="$(running)"
    previous_rev="$(docker inspect -f '{{index .Config.Labels "tv.subcult.source-revision"}}' subsets-landing 2>/dev/null || true)"
    [ "$(label "$image")" = "$rev" ] || { echo "Receive $image first" >&2; exit 1; }
    if [ "$previous" = "$image" ]; then echo "$image is already live"; exit 0; fi
    dir="$releases/${rev:0:12}"; mkdir -p "$dir"
    printf '{"image":"%s","revision":"%s","previousImage":"%s","previousRevision":"%s","started":"%s"}\n' \
      "$image" "$rev" "$previous" "$previous_rev" "$(date -u +%FT%TZ)" > "$dir/receipt.json"
    expected="$(docker run --rm --entrypoint cat "$image" /usr/share/nginx/html/index.html | sha256sum | cut -d' ' -f1)"
    if up "$image" "$rev" && sleep 2 && [ "$(curl -fsS "$url" | sha256sum | cut -d' ' -f1)" = "$expected" ]; then
      echo "deployed $image; $url serves its index.html"
      echo '{"result":"deployed"}' > "$dir/result.json"
    else
      echo "Verification failed; restoring $previous" >&2
      [ -n "$previous" ] && up "$previous" "${previous_rev:-unknown}"
      echo '{"result":"rolled-back"}' > "$dir/result.json"
      exit 1
    fi
    ;;
  status)
    echo "image=$(running) revision=$(docker inspect -f '{{index .Config.Labels "tv.subcult.source-revision"}}' subsets-landing 2>/dev/null)"
    ;;
  *) echo "Allowed: receive REVISION | deploy REVISION | status" >&2; exit 2 ;;
esac
