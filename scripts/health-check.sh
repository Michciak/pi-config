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
  url="http://127.0.0.1:$port/v1/models"
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 "$url" || true)
  if [ "$code" = 401 ] && [ -r /etc/llama-server/glm-api-key ]; then
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 -H "Authorization: Bearer $(cat /etc/llama-server/glm-api-key)" "$url" || true)
  fi
  printf '%s (%s): HTTP %s\n' "$name" "$port" "${code:-000}"
  if [ "${1:-}" = "--deep" ] && [ "$code" = 200 ] && [ -r /etc/llama-server/glm-api-key ]; then
    model=$(curl -sS --max-time 5 -H "Authorization: Bearer $(cat /etc/llama-server/glm-api-key)" "$url" | jq -r '.data[0].id // empty')
    payload=$(jq -nc --arg model "$model" '{model:$model,messages:[{role:"user",content:"Reply exactly HEALTH_OK"}],max_tokens:64,temperature:0,chat_template_kwargs:{enable_thinking:false}}')
    answer=$(curl -sS --max-time 30 -H "Authorization: Bearer $(cat /etc/llama-server/glm-api-key)" -H 'Content-Type: application/json' "http://127.0.0.1:$port/v1/chat/completions" -d "$payload" | jq -r '.choices[0].message.content // empty')
    if [ "$answer" = "HEALTH_OK" ]; then printf '%s inference: PASS\n' "$name"; else printf '%s inference: FAIL\n' "$name"; fail=1; fi
  fi
done
printf 'auth: configured in ~/.pi/agent/auth.json (not inspected)\n'
exit "$fail"
