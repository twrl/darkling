const js = require("@eslint/js");

module.exports = [
	js.configs.recommended,
	{
		files: ["**/*.ts", "**/*.tsx"],
		languageOptions: {
			parser: require("@typescript-eslint/parser"),
			parserOptions: {
				ecmaVersion: "latest",
				sourceType: "module",
				tsconfigRootDir: __dirname,
				project: true,
			},
		},
		plugins: {
			"@typescript-eslint": require("@typescript-eslint/eslint-plugin"),
		},
		rules: {
			"no-console": "warn",
		},
	},
];

// Temporary override: suppress unused variable warnings in app packages
module.exports.push({
	files: ["apps/frontend/**", "apps/backend/**"],
	rules: {
		"no-unused-vars": "off",
		"@typescript-eslint/no-unused-vars": "off",
	},
});
