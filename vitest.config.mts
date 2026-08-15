import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const projectRoot = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: [
      // Only rewrite "@/..." so package names such as "@vitest/expect" are
      // left untouched.
      { find: /^@\//, replacement: projectRoot },
    ],
  },
});
