# Context panel refinement — 2026-10-07

- Default **Przegląd** tab collects goal controls, TODO, active interactive-subagent/ACP counts, workflows, extension statuses/widgets and recent notices. These no longer occupy the transcript header. Active agents link to their existing chat; no agent is launched by navigation.
- Eight accessible icon tabs fit a single row. Each has an aria-label and tooltip; the selected panel displays its name. Side-panel spacing is reduced.
- Settings are a continuous categorized panel: services, notifications, model scope, local Mac/provider tools, diagnostics. The duplicate top-bar Settings button is removed. Process diagnostics load only when expanded.
- Plugin management has separate installed/access/catalog/local-install sections, an explicit empty state and labeled source field. Inspection is disabled for an empty path; installation and existing permission decisions are unchanged.
- Approval/decision cards use theme variables, compact borders and typography, bounded scroll areas, wrapping content and consistent action buttons.
- A session whose working directory is not a Git repository is a valid empty state, not an API failure. Status returns `repository:false`; branch listing returns an empty list. The UI hides Git write controls and explains the selected folder. Other Git/IO errors still propagate. No repository is initialized, and no child project is selected implicitly.

Verification: 144 unit/integration tests; 32 desktop/mobile browser tests; all workspace typechecks; versioned release build. Tests cover non-repository/unborn repositories, missing-directory errors, default overview, single-row navigation, continuous settings and long approval/decision content.

Release: `2026-10-07T07-30-23-743Z`.
Runtime backup: `/Users/michalkozinski/.pi/agent/backups/pi-web-control-20261007-093101`.

Live verification: BNC-voice3 remains idle with 1254 messages and its goal paused. The overview lists 44 historical child runs, with zero active subagents/ACP. Git in the NETRIX directory shows the non-repository empty state without an error banner. All eight tabs occupy one row and the outer context panel has zero padding. The browser service-worker update was activated. No prompt, goal continuation or plugin installation was sent.
