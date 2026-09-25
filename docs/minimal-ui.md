# Terminal integration removed

Warp/tmux UI customization is retired at the user's request.
Run `python3 scripts/remove-terminal-config.py` to archive our installed tmux
config, Warp keybindings and clipboard helper and restore changed tmux options
on known running servers. Matching uses Git history; modified files are preserved.
Pi configuration, file links, providers, agents, personal Warp settings and themes
remain. Runtime sync no longer deploys terminal settings. Restart old Pi/Warp
processes to clear negotiated keyboard state and cached shortcuts.
