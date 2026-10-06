import { eslintConfig } from '@kitschpatrol/eslint-config'

export default eslintConfig(
	{
		type: 'lib',
	},
	{
		files: ['test/**/*.ts'],
		rules: {
			'max-lines': 'off',
			'ts/no-unsafe-return': 'off',
			'ts/only-throw-error': 'off',
			'unicorn/prefer-code-point': 'off',
		},
	},
)
