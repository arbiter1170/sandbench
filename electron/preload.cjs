const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("sandbenchDesktop", {
  harnessBase: process.env.SANDBENCH_HARNESS_URL || "http://127.0.0.1:8799",
  // Token is injected by main via executeJavaScript / env for the static server proxy in packaged builds.
  // Dev Vite proxy still reads .harness-token itself.
  isDesktop: true,
});
