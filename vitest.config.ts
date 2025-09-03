import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/mocks/**"],
    include: ["src/test/**/*.t.ts"],
  },
});
