import { defineConfig } from "vitest/config";

const baseVitestConfig = defineConfig({
  test: {
    globals: true,
    reporters: "default",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["**/*.config.*", "**/dist/**", "**/coverage/**"]
    }
  }
});

export default baseVitestConfig;
