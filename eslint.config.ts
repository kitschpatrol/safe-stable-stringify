import { eslintConfig } from '@kitschpatrol/eslint-config'

export default eslintConfig(
	{
		ignores: ['changelog.md'],
		type: 'lib',
	},
	{
		files: ['test/**/*.ts'],
		rules: {
			'max-lines': 'off',
			'ts/no-confusing-void-expression': 'off',
			'ts/no-unsafe-return': 'off',
			'ts/only-throw-error': 'off',
			'unicorn/consistent-function-scoping': 'off',
			'unicorn/prefer-code-point': 'off',
		},
	},
)
