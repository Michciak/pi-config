import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {fileURLToPath} from "node:url";

export default defineConfig({
  plugins: [react()],
  // Browser-safe pure matching module from the same pinned Pi TUI runtime.
  resolve:{alias:{"@earendil-works/pi-tui":fileURLToPath(new URL("fuzzy.js",import.meta.resolve("@earendil-works/pi-tui")))}},
  server: { host: "127.0.0.1", port: 5173, proxy: { "/api": {
    target: "http://127.0.0.1:3784", changeOrigin: true, ws: true,
    configure(proxy) {
      // Match only this loopback dev server; preserve rejected third-party origins.
      const forwardOrigin = (outgoing: { setHeader(name: string, value: string): void }, request: { headers: { origin?: string; host?: string } }) => {
        if (request.headers.origin === `http://${request.headers.host}` && /^127\.0\.0\.1:\d+$/.test(request.headers.host ?? "")) outgoing.setHeader("origin", "http://127.0.0.1:3784");
      };
      proxy.on("proxyReq", forwardOrigin);
      proxy.on("proxyReqWs", forwardOrigin);
    },
  } } },
  build: { sourcemap: true,rollupOptions:{output:{manualChunks:{terminal:["@xterm/xterm","@xterm/addon-fit"],markdown:["react-markdown"],react:["react","react-dom"]}}} },
});
