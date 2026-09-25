#!/usr/bin/env python3
"""Install only tmux keyboard scrolling, on the explicitly current server."""
from datetime import datetime
import os
from pathlib import Path
import shutil
import subprocess


def main():
    context = os.environ.get('TMUX', '').rsplit(',', 2)
    if len(context) != 3 or not context[0]:
        raise SystemExit('Run inside tmux: Ctrl+b then c opens a shell. No files changed.')
    tmux = ['tmux', '-S', context[0]]
    subprocess.run(tmux + ['list-sessions'], check=True, capture_output=True)
    root = Path(__file__).resolve().parents[1]
    target = Path.home() / '.tmux.conf'
    addition = (root / 'tmux/keyboard-scroll.conf').read_text()
    begin, end = '# BEGIN pi keyboard scroll', '# END pi keyboard scroll'
    original = target.read_text() if target.exists() else ''
    if begin in original or end in original:
        if original.count(begin) != 1 or original.count(end) != 1 or original.index(end) < original.index(begin):
            raise SystemExit('Malformed managed block; preserving configuration.')
        start, stop = original.index(begin), original.index(end) + len(end)
        updated = original[:start] + begin + '\n' + addition + end + original[stop:]
    else:
        updated = original + ('\n' if original and not original.endswith('\n') else '') + begin + '\n' + addition + end + '\n'
    backup = Path.home() / '.pi/agent/backups' / ('keyboard-scroll-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    backup.mkdir(parents=True, mode=0o700)
    if target.exists():
        shutil.copy2(target, backup / 'tmux.conf')
    (backup / 'previous-bindings.txt').write_text(subprocess.check_output(tmux + ['list-keys'], text=True))
    target.write_text(updated)
    # Apply just the new bindings; do not source unrelated user configuration.
    subprocess.run(tmux + ['source-file', str(root / 'tmux/keyboard-scroll.conf')], check=True)
    print('Installed keyboard scrolling. Warp, mouse, clipboard and keyboard protocol unchanged.')
    print('Fn+Up: history; Fn+Down: down and exit at bottom; Escape/q: return to live Pi.')
    print('Backup:', backup)


if __name__ == '__main__':
    main()
