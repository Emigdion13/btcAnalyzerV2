import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.worker } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // `npm start` runs these under Node's strip-only TypeScript mode, which rejects any
    // TypeScript syntax that emits code. Vite tolerates it, so only lint catches it.
    files: ['server/**/*.ts', 'shared/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/parameter-properties': ['error', { prefer: 'class-property' }],
      'no-restricted-syntax': [
        'error',
        { selector: 'TSEnumDeclaration', message: 'Enums do not run under Node strip-types.' },
        {
          selector: 'TSModuleDeclaration[declare!=true]',
          message: 'Namespaces do not run under Node strip-types.',
        },
      ],
    },
  },
)
