import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Tooling lives with the existing server package; the config covers both apps.
const resolve = createRequire(new URL('./server/package.json', import.meta.url));
const globals = (await import(pathToFileURL(resolve.resolve('globals')).href)).default;
const parser = (await import(pathToFileURL(resolve.resolve('@babel/eslint-parser')).href)).default;

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/generated/**', '**/test-results/**', '**/playwright-report/**', 'web/public/ocr/**'] },
  {
    files: ['eslint.config.mjs', 'server/**/*.{js,mjs,ts}', 'web/**/*.{js,jsx}'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, ...globals.serviceworker },
      parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
      'no-undef': 'error', 'no-debugger': 'error', 'no-const-assign': 'error',
      'no-class-assign': 'error', 'no-dupe-args': 'error', 'no-dupe-keys': 'error',
      'no-unreachable': 'error', 'no-unsafe-finally': 'error',
      'no-async-promise-executor': 'error', 'no-unexpected-multiline': 'error',
    },
  },
  {
    files: ['server/**/*.ts'],
    languageOptions: { parser, parserOptions: { requireConfigFile: false,
      babelOptions: { babelrc: false, configFile: false, parserOpts: { plugins: ['typescript'] } } } },
    // TypeScript handles names in both type and value namespaces. Babel parses
    // syntax without a conflicting TypeScript peer dependency; tsc stays strict.
    rules: { 'no-undef': 'off', 'no-restricted-syntax': ['error', { selector: 'TSAnyKeyword', message: 'Use an explicit type or unknown.' }] },
  },
];
