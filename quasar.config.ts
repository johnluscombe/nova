import { defineConfig } from "#q-app";
import { coverageInstrumentation } from "./tests/coverage/instrumentation";

export default defineConfig(() => ({
    css: ["app.scss"],
    extras: ["roboto-font", "material-icons"],
    build: {
        typescript: { strict: true, vueShim: true },
        vueRouterMode: "hash",
        extendViteConf(config) {
            if (process.env.NOVA_COVERAGE === "1") {
                config.plugins ??= [];
                config.plugins.push(coverageInstrumentation());
                config.build ??= {};
                config.build.sourcemap = true;
            }
        }
    },
    electron: {
        preloadScripts: ["electron-preload"],
        inspectPort: 5858,
        bundler: "packager",
        packager: { icon: "src-electron/electron-assets/icons/nova" },
        builder: {
            appId: "nova",
            mac: { icon: "src-electron/electron-assets/icons/nova.icns" },
            win: { icon: "src-electron/electron-assets/icons/nova.ico" },
            linux: { icon: "src-electron/electron-assets/icons/nova.png" }
        }
    }
}));
