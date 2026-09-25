#!/usr/bin/env python3
"""Retire this project's terminal files; preserve user files and running sessions."""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from datetime import datetime


def main():
    root = Path(__file__).resolve().parents[1]
    backup = Path.home() / '.pi/agent/backups' / ('terminal-removal-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    candidates = [
        (Path.home() / '.tmux.conf', 'tmux/tmux.conf', 'tmux.conf'),
        (Path.home() / '.warp/keybindings.yaml', 'warp/keybindings.yaml', 'warp-keybindings.yaml'),
        (Path.home() / '.pi/agent/bin/tmux-paste.sh', 'scripts/tmux-paste.sh', 'tmux-paste.sh'),
    ]
    owned = []
    for target, relative, name in candidates:
        if not target.exists():
            continue
        revisions = subprocess.check_output(['git', '-C', str(root), 'log', '--format=%H', '--', relative], text=True).splitlines()
        versions = [subprocess.run(['git', '-C', str(root), 'show', f'{rev}:{relative}'], capture_output=True) for rev in revisions]
        if not any(v.returncode == 0 and v.stdout == target.read_bytes() for v in versions):
            raise SystemExit(f'Preserved modified file: {target}. No changes made.')
        owned.append((target, name))
    # Current server plus the two server names used in this project. Never kill them.
    selectors = [['tmux'], ['tmux', '-L', 'pi-baseline']]
    if os.environ.get('TMUX'):
        selectors.insert(0, ['tmux', '-S', os.environ['TMUX'].rsplit(',', 2)[0]])
    servers = {}
    for cmd in selectors:
        result = subprocess.run(cmd + ['display-message', '-p', '#{socket_path}'], capture_output=True, text=True)
        if result.returncode == 0 and result.stdout.strip():
            servers[result.stdout.strip()] = ['tmux', '-S', result.stdout.strip()]
        elif any(word in result.stderr.lower() for word in ('permission', 'permitted')):
            raise SystemExit('Cannot access tmux to remove live settings. No changes made.')
    spec = importlib.util.spec_from_file_location('reset', root / 'scripts/reset-tmux.py')
    reset = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reset)
    keys = {k: list(v) for k, v in reset.KEYS.items()}
    for table in ('prefix', 'copy-mode', 'copy-mode-vi'):
        keys[table] = list(set(keys.get(table, []) + (['v'] if table == 'prefix' else ['v', 'y'])))
    options = reset.OPTIONS + [('s', 'terminal-features')]
    defaults = []
    if servers:
        with tempfile.TemporaryDirectory(prefix='pi-terminal-defaults-', dir='/tmp') as folder:
            socket = Path(folder) / 'socket'
            clean = ['tmux', '-S', str(socket)]
            try:
                reset.run(clean, '-f', '/dev/null', 'new-session', '-d', '-s', 'defaults', 'exec /bin/sleep 60')
                if not socket.exists():
                    raise SystemExit('Cannot read tmux defaults. No changes made.')
                for flags, option in options:
                    defaults.append('set-option -' + flags + ' ' + reset.run(clean, 'show-options', '-' + flags, option).stdout.strip())
                for table, bindings in keys.items():
                    for key in bindings:
                        defaults.append(f'unbind-key -q -T {table} {key}')
                        original = reset.run(clean, 'list-keys', '-T', table, key, check=False)
                        if original.returncode == 0:
                            defaults.append(original.stdout.strip())
            finally:
                reset.run(clean, 'kill-server', check=False)
    backup.mkdir(parents=True, mode=0o700)
    restore = backup / 'terminal-defaults.conf'
    restore.write_text('\n'.join(defaults) + '\n')
    for index, cmd in enumerate(servers.values()):
        (backup / f'server-{index}-bindings.txt').write_text(reset.run(cmd, 'list-keys').stdout)
        (backup / f'server-{index}-options.txt').write_text(reset.run(cmd, 'show-options', '-s').stdout)
        reset.run(cmd, 'source-file', str(restore))
    for target, name in owned:
        shutil.move(str(target), str(backup / name))
        print('Removed active configuration:', target)
    print('Backup:', backup)
    print('Restart Pi and Warp to clear previously negotiated keyboard state and cached shortcuts.')
    print('Pi settings, providers, agents, Warp themes and personal settings are preserved.')


if __name__ == '__main__':
    main()
