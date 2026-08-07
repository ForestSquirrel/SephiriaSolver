// ESLint 9 flat config. The workflow originally referenced `.eslintrc.json` with
// `--no-eslintrc`, but that file was never added and both of those flags were removed
// in ESLint 9 — this replaces them.
import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['js/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      // Classic scripts sharing one global scope — no modules, no bundler.
      sourceType: 'script',
      globals: {
        window: 'readonly', document: 'readonly', console: 'readonly',
        fetch: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        localStorage: 'readonly', Image: 'readonly', requestAnimationFrame: 'readonly',
      },
    },
    rules: {
      // Every file's top-level functions and `let`s are deliberately global — used
      // from sibling files and from onclick= in index.html. ESLint lints one file at
      // a time and can't see that, so cross-file calls look undefined and every
      // declaration looks unused. `vars: 'local'` keeps the rule useful for genuinely
      // dead locals inside functions while ignoring the shared globals.
      'no-undef': 'off',
      'no-unused-vars': ['warn', { args: 'none', vars: 'local' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['.github/scripts/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'writable', process: 'readonly', console: 'readonly' },
    },
  },
];
