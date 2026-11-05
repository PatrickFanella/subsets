#!/usr/bin/env bash
set -euo pipefail
image=${1:?image is required}
docker run --rm --network none --entrypoint nginx "$image" -t
fixture=$(docker create --network none --read-only --tmpfs /tmp --tmpfs /var/cache/nginx \
  --tmpfs /var/run --cap-drop ALL --security-opt no-new-privileges:true "$image")
trap 'docker rm -f "$fixture" >/dev/null' EXIT
docker start "$fixture" >/dev/null
for _attempt in {1..20}; do
  if docker exec "$fixture" wget -q -T 2 -O /dev/null http://127.0.0.1:8080/; then
    break
  fi
  sleep 0.2
done
docker exec "$fixture" wget -q -T 2 -O - http://127.0.0.1:8080/ | grep -q Subsets
docker exec "$fixture" wget -q -T 2 -O /dev/null http://127.0.0.1:8080/favicon.ico
docker exec "$fixture" wget -q -T 2 -O /dev/null http://127.0.0.1:8080/apple-touch-icon.png
docker exec "$fixture" wget -q -T 2 -O /dev/null http://127.0.0.1:8080/assets/brand/social/og.png
