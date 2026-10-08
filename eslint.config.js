// ESLint flat config for the TS monorepo (api, web, packages/*). The Python service, the pilot webapp
// and other legacy folders are out of scope. Architectural guard rails (A12) are encoded as
// no-restricted-imports / no-restricted-syntax and re-checked by api/test/architecture.test.ts.
import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const PRISMA_IMPORTS = {
  group: ['@prisma/client', '@prisma/client/*', '@prisma/adapter-pg', '**/generated/prisma', '**/generated/prisma/**'],
  message: 'Only api/src/db/** and api/scripts/** may use the Prisma client (tenant isolation).',
};
const SYSTEM_DB_IMPORTS = {
  regex: '(^|/)db/system(\\.js)?$',
  message: 'System-mode DB access is restricted to api/src/{auth,platform,audit,db}/** and api/scripts/**.',
};
const WEB_IMPORTS = { group: ['@fr/web', '**/web/src/**'], message: 'api must not import from web.' };
const CHILD_PROCESS = { name: 'node:child_process', message: 'Spawning processes is banned in the API.' };
const CHILD_PROCESS_BARE = { name: 'child_process', message: 'Spawning processes is banned in the API.' };

const UNSAFE_RAW = {
  selector: 'MemberExpression[property.name=/^\\$(queryRawUnsafe|executeRawUnsafe)$/]',
  message: 'Unsafe raw SQL is banned.',
};
const RAW_SQL = {
  selector: 'MemberExpression[property.name=/^\\$(queryRaw|executeRaw)$/]',
  message: 'Raw SQL is allowed only in api/src/audit/**, api/src/db/** and api/scripts/**.',
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'api/src/generated/**',
      'src/**',
      'tests/**',
      'webapp/**',
      'developer-portal/**',
      'marketing/**',
      'business/**',
      'financial/**',
      'fundraising/**',
      'hiring/**',
      'technical/**',
      'deploy/**',
      'infra/**',
      '.claude/**',
      '.claude-flow/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-syntax': ['error', UNSAFE_RAW],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: { ...globals.node } },
  },
  // ---------------------------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------------------------
  {
    files: ['api/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-restricted-imports': ['error', { paths: [CHILD_PROCESS, CHILD_PROCESS_BARE], patterns: [PRISMA_IMPORTS, SYSTEM_DB_IMPORTS, WEB_IMPORTS] }],
      'no-restricted-syntax': ['error', UNSAFE_RAW, RAW_SQL],
    },
  },
  {
    files: ['api/src/db/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [CHILD_PROCESS, CHILD_PROCESS_BARE], patterns: [WEB_IMPORTS] }],
      'no-restricted-syntax': ['error', UNSAFE_RAW],
    },
  },
  {
    files: ['api/src/audit/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [CHILD_PROCESS, CHILD_PROCESS_BARE], patterns: [PRISMA_IMPORTS, WEB_IMPORTS] }],
      'no-restricted-syntax': ['error', UNSAFE_RAW],
    },
  },
  {
    files: ['api/src/auth/**/*.ts', 'api/src/platform/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [CHILD_PROCESS, CHILD_PROCESS_BARE], patterns: [PRISMA_IMPORTS, WEB_IMPORTS] }],
    },
  },
  {
    files: ['api/scripts/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [WEB_IMPORTS] }],
      'no-restricted-syntax': ['error', UNSAFE_RAW],
    },
  },
  {
    files: ['api/test/**/*.ts', 'api/test-acceptance/**/*.ts'],
    rules: {
      // Tests may inspect the database directly (owner role) to assert isolation and append-only guarantees.
      'no-restricted-imports': ['error', { patterns: [WEB_IMPORTS] }],
      'no-restricted-syntax': 'off',
    },
  },
  // ---------------------------------------------------------------------------------------------
  // Web
  // ---------------------------------------------------------------------------------------------
  {
    files: ['web/**/*.{ts,tsx}'],
    plugins: { react, 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    languageOptions: { globals: { ...globals.browser } },
    settings: { react: { version: '19.3' } },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/no-danger': 'error',
      'react/jsx-no-target-blank': 'error',
      'react/jsx-no-script-url': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: '@fr/api', message: 'web must not import from api.' }],
          patterns: [{ regex: '^(\\.\\./)+api/(src|prisma|scripts|test)', message: 'web must not import from api.' }],
        },
      ],
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Render text nodes only.' },
        { property: 'outerHTML', message: 'Render text nodes only.' },
        { property: 'insertAdjacentHTML', message: 'Render text nodes only.' },
        { object: 'document', property: 'write', message: 'Never document.write.' },
        { object: 'localStorage', message: 'No tokens or data in browser storage.' },
        { object: 'sessionStorage', message: 'No tokens or data in browser storage.' },
      ],
    },
  },
);
