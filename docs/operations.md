# Operations

Run `scripts/health-check.sh` for non-secret diagnostics. It reports endpoint HTTP
status without printing authorization headers. Run Pi with `/config-health` for the
same checks from the loaded package.

Back up user configuration before changing `~/.pi/agent/settings.json` or
`models.json`. Never commit `auth.json`, tokens, cookies, or server key files.
