import tseslint from 'typescript-eslint';

export default [
  // Global ignores
  {
    ignores: [
      "dist/**",
      "docs/**",
      "node_modules/**",
      "ui/**",
      "**/*.js",
      "**/*.js.map",
      "**/*.d.ts",
      "**/*.d.ts.map",
      "*.js",
      "*.mjs",
      "src/extensions/examples/**",
    ],
  },
  // TypeScript source files in src/
  {
    files: ["src/**/*.ts"],
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parser: tseslint.parser,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
    },
  },
];
