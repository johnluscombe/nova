import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
    plugins: [vue()],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
            electron: fileURLToPath(
                new URL(
                    "./src-electron/node_modules/electron/index.js",
                    import.meta.url
                )
            )
        }
    },
    test: {
        environment: "node",
        include: ["tests/unit/**/*.test.{ts,mjs}"],
        exclude: ["**/node_modules/**"],
        coverage: {
            provider: "istanbul",
            reportsDirectory: "coverage/unit",
            reporter: ["text", "html", "lcov", "json"],
            include: [
                "src/**/*.ts",
                "src/**/*.vue",
                "src-electron/**/*.ts",
                "src-electron/electron-assets/plugins/**/*.mjs"
            ],
            exclude: [
                "**/*.d.ts",
                "src-electron/electron-main.ts",
                "src-electron/electron-preload.ts"
            ]
        }
    }
});
