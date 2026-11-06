import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const relay = "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  // Browser navigations to /console/* load the SPA; its fetch() calls to the same prefix go to the relay.
  server: { proxy: { "/console": { target: relay, bypass: (req) => (req.headers.accept?.includes("text/html") ? "/index.html" : undefined) }, "/checkout": relay } },
  test: { environment: "node" },
});
