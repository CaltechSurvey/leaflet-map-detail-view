'use strict';

module.exports = [
	{
		files: ['src/**/*.js'],
		languageOptions: {
			ecmaVersion: 5,
			sourceType: 'script',
			globals: { window: 'readonly', document: 'readonly', define: 'readonly', module: 'writable', exports: 'writable', require: 'readonly' }
		},
		rules: {
			'no-unused-vars': 'error',
			'no-undef': 'error',
			eqeqeq: ['error', 'smart'],
			curly: 'error',
			semi: ['error', 'always']
		}
	},
	{
		files: ['test/**/*.js', 'eslint.config.js'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'commonjs',
			globals: { require: 'readonly', module: 'writable', __dirname: 'readonly' }
		}
	}
];
