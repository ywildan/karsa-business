import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  functions: {
    api: {
      name: "Karsa Business API",
      source: "./functions/api.ts",
    },
  },
});

