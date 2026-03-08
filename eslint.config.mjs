import tseslint from 'typescript-eslint';

export default [
  // Global ignores
  {
    ignores: [
      "dist/**/*",
      "docs/**/*",
      "node_modules/**/*",
      "ui/**/*",
      "*.js",
      "*.mjs",
      "src/extensions/examples/**/*",
    ],
  },
  // TypeScript source files
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
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          "argsIgnorePattern": "^_",
          "varsIgnorePattern": "^_",
        }
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
    },
  },
];
