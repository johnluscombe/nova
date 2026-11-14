import { defineConfig } from "oxfmt";

export default defineConfig({
    $schema: "./node_modules/oxfmt/configuration_schema.json",

    ignorePatterns: [
        "**/node_modules/",
        "dist/",
        "quasar.config.*.temporary.compiled*",
        ".quasar/",
        "src-cordova/",
        "src-capacitor/",
        "src/router/typed-router.d.ts"
    ],

    printWidth: 80,
    arrowParens: "avoid",
    bracketSpacing: true,
    bracketSameLine: true,
    htmlWhitespaceSensitivity: "ignore",
    semi: true,
    singleQuote: false,
    quoteProps: "as-needed",
    tabWidth: 4,
    trailingComma: "none",
    useTabs: false,
    vueIndentScriptAndStyle: false
});
