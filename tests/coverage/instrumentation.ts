import instrumentation from "istanbul-lib-instrument";
import type { Plugin } from "vite";
import path from "node:path";

/** Preserve Vite's source maps through instrumentation, including Vue SFCs. */
export function coverageInstrumentation(): Plugin {
    const instrumenter = instrumentation.createInstrumenter({
        esModules: true,
        coverageGlobalScope: "globalThis",
        coverageGlobalScopeFunc: false,
        produceSourceMap: true
    });
    const sourceRoot = path.resolve("src") + path.sep;

    return {
        name: "nova-istanbul",
        enforce: "post",

        /**
         * Instrument eligible source modules while retaining their
         * original source maps.
         */
        transform(code, id) {
            const [filename, query] = id.split("?");

            if (
                !filename?.startsWith(sourceRoot) ||
                !/\.(vue|ts|js)$/.test(filename)
            ) {
                return;
            }

            if (query && !query.includes("type=script")) {
                return;
            }

            if (
                filename.endsWith(".vue") &&
                !query &&
                /import _sfc_main from/.test(code)
            ) {
                return;
            }

            const sourceMap = this.getCombinedSourcemap();
            const instrumented = instrumenter.instrumentSync(
                code,
                filename,
                sourceMap as unknown as Parameters<
                    typeof instrumenter.instrumentSync
                >[2]
            );

            return {
                code: instrumented,
                map: JSON.stringify(instrumenter.lastSourceMap())
            };
        }
    };
}
