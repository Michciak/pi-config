# Operations

Run `scripts/health-check.sh` for non-secret diagnostics. Interactive subagents open a split pane in the parent tmux window. Pi must be started inside tmux so `$TMUX_PANE` is available. It reports endpoint HTTP
status without printing authorization headers. Run Pi with `/config-health` for the
same checks from the loaded package.

Back up user configuration before changing `~/.pi/agent/settings.json` or
`models.json`. Never commit `auth.json`, tokens, cookies, or server key files.
