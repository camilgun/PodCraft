import path from "path";
import { defineConfig, mergeConfig } from "vitest/config";
import baseVitestConfig from "../../vitest.config.base";

export default mergeConfig(
  baseVitestConfig,
  defineConfig({
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    test: {
      environment: "jsdom",
    },
  }),
);
