#!/usr/bin/env bash
set -u
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
fail=0
printf 'package: %s\n' "$root"
for file in settings/models.json settings/model-capabilities.json; do
  if jq empty "$root/$file" >/dev/null 2>&1; then printf '%s: readable\n' "$file"; else printf '%s: ERROR\n' "$file"; fail=1; fi
done
for pair in 'local-qwen36:8081' 'local-glm:8080'; do
  name=${pair%:*}; port=${pair#*:}
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$port/v1/models" || true)
  printf '%s (%s): HTTP %s\n' "$name" "$port" "${code:-000}"
done
printf 'auth: configured in ~/.pi/agent/auth.json (not inspected)\n'
exit "$fail"
