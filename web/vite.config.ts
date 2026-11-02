import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const relay = "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/console": relay, "/checkout": relay } },
  test: { environment: "node" },
});
