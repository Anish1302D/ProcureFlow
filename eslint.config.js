// ESLint flat config for the whole repository: the React frontend in `src/`,
// the Node API in `server/`, and the build-tool configs at the root.
//
// ESLint stays on the 9.x line because eslint-plugin-react's peer range ends
// at ^9.7 — ESLint 10 cannot be installed alongside it yet.
//
// Run with `npm run lint` (add `-- --fix` to apply the fixable ones).

import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  // Nothing in here is ours to lint: dependencies, build output, generated
  // SQL/JSON, and scratch work kept deliberately outside the build.
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'server/node_modules/**',
      'scratch/**',
      'db/**',
      'docs/**',
      // TypeScript, and there is no TS parser configured — it is a single
      // stray file that nothing imports.
      'neon.ts',
    ],
  },

  js.configs.recommended,

  // ---------------------------------------------------------------------
  // The React frontend. Browser globals; JSX; hooks rules.
  // ---------------------------------------------------------------------
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,

      // This codebase uses the automatic JSX runtime (@vitejs/plugin-react),
      // so React need not be imported to use JSX. `jsx-uses-react` stays on:
      // 50 of the 51 components still carry `import React from 'react'`, and
      // the rule is what stops no-unused-vars from flagging every one of them.
      // (Those imports are redundant under the automatic runtime and could be
      // removed, but that is a 50-file change with no behavioural effect.)
      'react/react-in-jsx-scope': 'off',

      // Props are not type-checked here and there is no intention to add
      // prop-types; the API response shapes are the contract instead.
      'react/prop-types': 'off',

      // Apostrophes in ordinary English UI copy ("the department's budget").
      // The rule guards against text that could be mistaken for a JSX quote;
      // escaping a dozen user-visible strings to &apos; would make the copy
      // harder to read and proofread for no rendering benefit.
      'react/no-unescaped-entities': 'off',

      // Unused caught errors are idiomatic in this codebase (storage and
      // JSON parsing both swallow deliberately, with a comment).
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
    },
  },

  // ---------------------------------------------------------------------
  // The Node API and its scripts and tests.
  // ---------------------------------------------------------------------
  {
    files: ['src/**/*.test.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
    },
  },

  // ---------------------------------------------------------------------
  // The Node API and its scripts and tests.
  // ---------------------------------------------------------------------
  {
    files: ['server/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
    },
  },

  // Express error middleware is identified by its four-parameter shape, so
  // `next` must stay declared even when the handler never calls it.
  {
    files: ['server/src/app.js', 'server/src/errors.js'],
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
    },
  },

  // ---------------------------------------------------------------------
  // Build-tool configs at the root: Node, module syntax.
  // ---------------------------------------------------------------------
  {
    files: ['*.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
    },
  },
];
