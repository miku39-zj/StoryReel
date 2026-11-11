import { FlatCompat } from "@eslint/eslintrc";
import prettier from "eslint-config-prettier/flat";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".storyreel/**",
      ".superdesign/**",
      ".claude/**",
      "out/**",
      "coverage/**",
      "tests/artifacts/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  prettier,
];

export default config;
