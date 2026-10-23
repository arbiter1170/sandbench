import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import { AuthGate } from "./AuthGate";
import "./styles.css";

registerSW({ immediate: true });

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <AuthGate>{(user) => <App user={user} />}</AuthGate>
    </StrictMode>,
  );
}
