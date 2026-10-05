/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

/** Inject a strict CSP <meta> whose connect-src is exactly 'self' + the configured API origin. */
function csp(apiOrigin: string, dev: boolean): Plugin {
  return {
    name: "freight-csp",
    transformIndexHtml(html) {
      const connect = ["'self'", apiOrigin].filter(Boolean).join(" ");
      // Dev needs ws: for HMR and inline preamble; production is fully strict (no inline script/style).
      const policy = dev
        ? `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: ${apiOrigin}; img-src 'self' data:`
        : `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src ${connect}; base-uri 'none'; form-action 'none'; object-src 'none'`;
      return html.replace("__CSP__", policy);
    },
  };
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const target = env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8000";
  const base = env.VITE_API_BASE_URL || "";
  let origin = "";
  try {
    origin = base ? new URL(base).origin : "";
  } catch {
    throw new Error("VITE_API_BASE_URL must be an absolute URL or empty");
  }
  return {
    plugins: [react(), csp(origin, command === "serve")],
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: { "/api": { target, changeOrigin: false, rewrite: (p) => p.replace(/^\/api/, "") } },
      headers: { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" },
    },
    build: { sourcemap: false, target: "es2022" },
    test: { environment: "jsdom", globals: true, setupFiles: ["tests/setup.ts"] },
  };
});
