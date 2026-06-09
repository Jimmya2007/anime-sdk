import tailwind from 'eslint-plugin-tailwindcss';
import astroParser from 'astro-eslint-parser';
import tsParser from '@typescript-eslint/parser';
import { join } from 'path';

const configPath = join(import.meta.dirname, 'tailwind.config.js');

export default [
  ...tailwind.configs['flat/recommended'],
  {
    files: ['src/**/*.astro'],
    languageOptions: {
      parser: astroParser,
      parserOptions: {
        parser: tsParser,
        extraFileExtensions: ['.astro'],
      },
    },
  },
  {
    files: ['src/**/*.{ts,tsx,js}'],
    languageOptions: {
      parser: tsParser,
    },
  },
  {
    settings: {
      tailwindcss: {
        config: configPath,
      },
    },
    rules: {
      'tailwindcss/classnames-order': 'warn',
      'tailwindcss/no-custom-classname': 'off',
    },
  },
];
