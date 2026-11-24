import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([".next/**", "node_modules/**", "coverage/**", "work/**", "dist-desktop/**", "public/offline/**"]),
  { files: ["desktop/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
  { files: ["src/offline/**"], rules: { "@next/next/no-html-link-for-pages": "off" } },
]);
