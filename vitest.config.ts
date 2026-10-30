import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "edge-runtime", include: ["convex/**/*.test.ts"], server: { deps: { inline: ["@convex-dev/workpool", "@convex-dev/rate-limiter", "@convex-dev/batch-worker"] } } } });
