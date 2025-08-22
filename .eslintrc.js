/**
 * ESLint configuration for the project
 * Defines linting rules, parser options, and import resolution settings
 */
module.exports = {
  // Base configuration to extend from
  extends: 'erb',

  // Additional ESLint plugins to use
  plugins: ['@typescript-eslint'],

  /**
   * Custom linting rules configuration
   * Overrides or adds specific rules beyond the base configuration
   */
  rules: {
    // A temporary hack related to IDE not resolving correct package.json
    'import/no-extraneous-dependencies': 'off',
    'react/react-in-jsx-scope': 'off',
    'react/jsx-filename-extension': 'off',
    'react/require-default-props': 'warn',
    'import/extensions': 'off',
    'import/no-unresolved': 'warn',
    'import/no-import-module-exports': 'off',
    'no-shadow': 'warn',
    '@typescript-eslint/no-shadow': 'error',
    'no-unused-vars': 'warn',
    'react-hooks/exhaustive-deps': 'warn',
    '@typescript-eslint/no-unused-vars': 'error',
    'prefer-destructuring': 'warn',
    'react/jsx-props-no-spreading': 'warn',
  },

  /**
   * Parser configuration options
   * Specifies how ESLint should parse the source code
   */
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
    createDefaultProgram: true,
  },

  /**
   * Additional settings for ESLint plugins
   * Configures import resolution and parser mappings
   */
  settings: {
    'import/resolver': {
      // See https://github.com/benmosher/eslint-plugin-import/issues/1396#issuecomment-575727774 for line below
      node: {},
      webpack: {
        config: require.resolve('./.erb/configs/webpack.config.eslint.ts'),
      },
      typescript: {},
    },
    'import/parsers': {
      '@typescript-eslint/parser': ['.ts', '.tsx'],
    },
  },
};
