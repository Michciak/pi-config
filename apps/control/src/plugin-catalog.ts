// Pinned, non-installing catalogue adapted from MIT pi-web-ui 0.97.0.
export const pluginCatalog = [
  {
    "id": "webmail",
    "name": "webmail",
    "description": "Web mail: IMAP inbox + SMTP send + new-mail notifications, optionally let the AI manage mail.",
    "source": "xing-shuyin/pi-web-ui/plugins/webmail",
    "homepage": "https://github.com/xing-shuyin/pi-web-ui/tree/main/plugins/webmail"
  },
  {
    "id": "db-client",
    "name": "db-client",
    "description": "Database client: browse schemas, run SQL and edit data across MySQL / PostgreSQL / SQLite / SQL Server / MongoDB / Redis.",
    "source": "xing-shuyin/pi-web-ui/plugins/db-client",
    "homepage": "https://github.com/xing-shuyin/pi-web-ui/tree/main/plugins/db-client"
  },
  {
    "id": "vscode-editor",
    "name": "vscode-editor",
    "description": "VSCode-like workbench: multi-root file tree, CodeMirror editor, integrated terminal, Remote-SSH and SFTP sync; registers SFTP/SSH/remote-file tools so the AI can deploy code itself.",
    "source": "xing-shuyin/pi-web-ui/plugins/vscode-editor",
    "homepage": "https://github.com/xing-shuyin/pi-web-ui/tree/main/plugins/vscode-editor"
  },
  {
    "id": "mermaid",
    "name": "mermaid",
    "description": "Renders ```mermaid fences in messages to SVG diagrams (fenced-code renderer plugin, offline-first local engine).",
    "source": "xing-shuyin/pi-web-ui/plugins/mermaid",
    "homepage": "https://github.com/xing-shuyin/pi-web-ui/tree/main/plugins/mermaid"
  },
  {
    "id": "run-trace",
    "name": "run-trace",
    "description": "Run trajectory: task → thinking → tools → file changes → result timeline with replay and node details.",
    "source": "xing-shuyin/pi-web-ui/plugins/run-trace",
    "homepage": "https://github.com/xing-shuyin/pi-web-ui/tree/main/plugins/run-trace"
  },
  {
    "id": "legado-web",
    "name": "legado-web",
    "description": "Legado reader (text book sources): search / explore / info / TOC / content with Android-compatible book source JSON, plus source import and health checking. Ships its own CORS+GBK proxy, local store, and AI tools to diagnose and repair book sources.",
    "source": "xing-shuyin/pi-web-ui/plugins/legado-web",
    "homepage": "https://github.com/xing-shuyin/pi-web-ui/tree/main/plugins/legado-web"
  },
  {
    "id": "wechat-ilink",
    "name": "微信通道",
    "description": "WeChat channel (ilink protocol, same origin as Tencent openclaw-weixin): outbound long-polling, drive the agent from WeChat, no public IP needed.",
    "source": "xing-shuyin/pi-web-ui/plugins/wechat-ilink",
    "homepage": "https://github.com/xing-shuyin/pi-web-ui/tree/main/plugins/wechat-ilink"
  },
  {
    "id": "voice-input",
    "name": "语音输入",
    "description": "Voice input: a mic button next to the composer. Browser speech recognition dictates into the input box, with server-side transcription as automatic fallback (remote API, or one-click local Whisper that runs fully offline).",
    "source": "xing-shuyin/pi-web-ui/plugins/voice-input",
    "homepage": "https://github.com/xing-shuyin/pi-web-ui/tree/main/plugins/voice-input"
  },
  {
    "id": "live-preview",
    "name": "live-preview",
    "description": "Live-Server-style preview: HTML under /liveserver (relative assets + auto reload), rendered Markdown under /md. Loopback-only inner server exposed via host proxy prefixes.",
    "source": "xing-shuyin/pi-web-ui/plugins/live-preview",
    "homepage": "https://github.com/xing-shuyin/pi-web-ui/tree/main/plugins/live-preview"
  },
  {
    "id": "image-toolkit",
    "name": "image-toolkit",
    "description": "Image workbench: compress (with target-size binary search), crop, resize, rotate/flip, format conversion (PNG/JPEG/WebP/AVIF), batch ZIP export, watermark, filters, image info + EXIF, and direct workspace read/write. Ships 4 AI tools so the agent can compress/crop/resize/watermark workspace images itself.",
    "source": "xing-shuyin/pi-web-ui/plugins/image-toolkit",
    "homepage": "https://github.com/xing-shuyin/pi-web-ui/tree/main/plugins/image-toolkit"
  },
  {
    "id": "notes",
    "name": "笔记",
    "description": "Notes, todos and scheduled reminders in one place: a freely draggable always-on-top panel (position, size and settings all live in it, no separate view tab); reminders fire server-side (survive restarts, delivered on next open), with 5 AI tools and /note /todo /remind quick capture.",
    "source": "xing-shuyin/pi-web-ui/plugins/notes",
    "homepage": "https://github.com/xing-shuyin/pi-web-ui/tree/main/plugins/notes"
  },
  {
    "id": "desktop-use",
    "name": "桌面控制",
    "description": "Let the AI drive the Windows desktop: find controls by name via UI Automation (no screenshots) → click / type (CJK via paste) / hotkeys / focus windows. The input library auto-installs on activate and is removed with the plugin.",
    "source": "xing-shuyin/pi-web-ui/plugins/desktop-use",
    "homepage": "https://github.com/xing-shuyin/pi-web-ui/tree/main/plugins/desktop-use"
  },
  {
    "id": "pi-web-multigit",
    "name": "multi-git",
    "description": "Multi-repo Git overview: changes, diffs, history, branches, stashes, cross-repo search and a timeline for every repository in the workspace, plus a workspace-wide branch view, Fetch/Pull and an optional terminal.",
    "source": "EinErste/pi-web-multigit",
    "homepage": "https://github.com/EinErste/pi-web-multigit"
  },
  {
    "id": "reconnect",
    "name": "重连",
    "description": "Reconnection & service recovery: inspect web service and companion watchdog health, reconnect or restart services in one click (supports multi-service restarts with companion watchdog).",
    "source": "xieweimo/pi-web-ui-reconnect-watchdog/reconnect-plugin",
    "homepage": "https://github.com/xieweimo/pi-web-ui-reconnect-watchdog"
  },
  {
    "id": "sol-savings",
    "name": "SoL-Pi 状态",
    "description": "SoL-Pi session savings and plan status in the footer bar: real-time tracking of context tokens saved by Observation Pack and active Plan progress, inspired by pi-sol-plan-footer.",
    "source": "xing-shuyin/pi-web-ui/plugins/sol-savings",
    "homepage": "https://github.com/xing-shuyin/pi-web-ui/tree/main/plugins/sol-savings"
  },
  {
    "id": "session-migrate",
    "name": "会话迁移",
    "description": "Scan ~/.omp/agent/sessions and ~/.pi/agent/sessions history, preview read-only, then import into the pi session store (issue 286 Phase 1).",
    "source": "xing-shuyin/pi-web-ui/plugins/session-migrate",
    "homepage": "https://github.com/xing-shuyin/pi-web-ui/tree/main/plugins/session-migrate"
  }
];

