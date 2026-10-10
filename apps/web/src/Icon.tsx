export type IconName = "folder" | "file" | "search" | "up" | "refresh" | "upload" | "send" | "attach" | "chevron" | "restart" | "play" | "stop" | "overview" | "git" | "extensions" | "plugins" | "models" | "tools" | "settings";
const paths: Record<IconName, string> = {
  overview: "M4 4h6v6H4ZM14 4h6v6h-6ZM4 14h6v6H4ZM14 14h6v6h-6Z",
  git: "M6 3v12a4 4 0 0 0 4 4h2M18 3v5a4 4 0 0 1-4 4H6M4 3a2 2 0 1 0 4 0 2 2 0 1 0-4 0M16 3a2 2 0 1 0 4 0 2 2 0 1 0-4 0M12 19a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
  extensions: "M4 4h5V2h6v2h5v5h2v6h-2v5h-5v2H9v-2H4v-5H2V9h2Z",
  plugins: "M8 2v6M16 2v6M5 8h14v4a7 7 0 0 1-7 7v3M5 8v4a7 7 0 0 0 7 7",
  models: "m12 3 9 5-9 5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5",
  tools: "M14 4a6 6 0 0 0-7 8L3 19l2 2 7-4a6 6 0 0 0 8-7l-4 4-4-4 4-4Z",
  settings: "M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6",
  folder: "M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z",
  file: "M14 3H5v18h14V8ZM14 3v6h5M8 13h8M8 17h6",
  search: "M20 20l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  up: "M12 20V4M5 11l7-7 7 7",
  refresh: "M20 7V3l-4 4M20 7a9 9 0 1 0 1 8",
  restart: "M20 7V3l-4 4M4 17v4l4-4M20 7a9 9 0 0 0-16-1M4 17a9 9 0 0 0 16 1",
  play: "m8 4 12 8-12 8Z",
  stop: "M5 5h14v14H5Z",
  upload: "M12 16V3M7 8l5-5 5 5M4 15v6h16v-6",
  send: "M12 19V5M6 11l6-6 6 6",
  attach: "m8 12 6-6a3 3 0 0 1 4 4L9 19a5 5 0 0 1-7-7l10-10",
  chevron: "m9 5 7 7-7 7",
};
export function Icon({name, className=""}: {name: IconName; className?: string}) {
  return <svg className={`ui-icon ${className}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
