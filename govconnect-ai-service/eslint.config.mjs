import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        Buffer: 'readonly',
        NodeJS: 'readonly',
        Express: 'readonly',
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      'no-console': 'warn',
      'no-unused-vars': 'off',
      'no-control-regex': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='req'][property.name='query']",
          message: 'Gunakan getQuery(...) untuk menormalisasi req.query.',
        },
        {
          selector: "MemberExpression[object.name='req'][property.name='params']",
          message: 'Gunakan getParam(...) untuk menormalisasi req.params.',
        },
      ],
    },
  },
];
