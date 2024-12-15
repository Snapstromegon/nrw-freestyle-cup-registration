import { configs as wcConfigs } from "eslint-plugin-wc";
import { configs as litConfigs } from "eslint-plugin-lit";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  eslint.configs.recommended,
  ...tseslint.configs.stylistic,
  wcConfigs["flat/best-practice"],
  litConfigs["flat/all"],
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-unused-vars": "off", // covered by @typescript-eslint/no-unused-vars
    },
  },
  { ignores: ["src/ts/bindings.d.ts"] },
];
