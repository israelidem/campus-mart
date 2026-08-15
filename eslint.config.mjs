import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescriptConfig from "eslint-config-next/typescript";

/** ESLint flat config (eslint-config-next 16 ships native flat configs). */
const eslintConfig = [
  ...coreWebVitals,
  ...typescriptConfig,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      // Generated Prisma Client — never hand-edited, never linted.
      "lib/generated/**",
      "public/sw.js",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // The shared Prisma client is the only place allowed to construct one.
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "services/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='PrismaClient']",
          message:
            "Do not instantiate PrismaClient directly. Import the shared client from '@/lib/db/prisma'.",
        },
      ],
    },
  },
];

export default eslintConfig;
