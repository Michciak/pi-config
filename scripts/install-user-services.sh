#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
target="$HOME/.config/systemd/user"
mkdir -p "$target"
install -m 0644 "$root/services/llama-qwen36.service" "$target/llama-qwen36.service"
install -m 0644 "$root/services/llama-glm47.service" "$target/llama-glm47.service"
systemctl --user daemon-reload
printf '%s\n' 'Installed user units; neither unit was enabled or started.'
printf '%s\n' 'Start deliberately with: systemctl --user start llama-qwen36.service'
