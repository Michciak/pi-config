import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import "./style.css";
import "./upstream-themes.css";
import "./compact-ui.css";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(registration => {
    const announce = () => window.dispatchEvent(new Event("pi-shell-update"));
    if (registration.waiting) announce();
    registration.addEventListener("updatefound", () => registration.installing?.addEventListener("statechange", () => {
      if (registration.waiting && navigator.serviceWorker.controller) announce();
    }));
  }).catch(() => {});
}
