import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import { AuthGate } from "./AuthGate";
import "./styles.css";
import { installViewportFit } from "./viewportFit";

registerSW({ immediate: true });
// UX P4: the composer stays above a phone's soft keyboard.
installViewportFit();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <AuthGate>{(user) => <App user={user} />}</AuthGate>
    </StrictMode>,
  );
}
