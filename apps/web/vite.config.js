import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import packageJson from "./package.json" with { type: "json" };
import { execSync } from "node:child_process";

const appCommit = execSync("git rev-parse --short HEAD", {
  encoding: "utf8",
}).trim();

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __APP_COMMIT__: JSON.stringify(appCommit),
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      "/health": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
