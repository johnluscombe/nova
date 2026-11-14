import { test, expect } from "vitest";
import vm from "node:vm";
import path from "node:path";
import coverageLibrary from "istanbul-lib-coverage";
import sourceMaps from "istanbul-lib-source-maps";
import { coverageInstrumentation } from "../coverage/instrumentation.ts";

test("instrumentation preserves original Vue line locations instead of generated lines", async () => {
    const plugin = coverageInstrumentation();
    const file = path.resolve("src/Fixture.vue");
    const source =
        "<template><div /></template>\n<script setup>\n\n\nconst result = 42;\n</script>";
    const sourceMap = {
        version: 3,
        file,
        sources: [file],
        sourcesContent: [source],
        names: [],
        mappings: "AAIA"
    };
    const context = { getCombinedSourcemap: () => sourceMap };
    const transformed = plugin.transform.call(
        context,
        "const result = 42;",
        file
    );
    const sandbox = vm.createContext({});
    vm.runInContext(transformed.code, sandbox);
    const remapped = await sourceMaps
        .createSourceMapStore()
        .transformCoverage(
            coverageLibrary.createCoverageMap(sandbox.__coverage__)
        );
    expect(remapped.fileCoverageFor(file).getLineCoverage()).toEqual({ 5: 1 });
    expect(
        plugin.transform.call(context, "", "/node_modules/package/index.js")
    ).toBeUndefined();
    expect(
        plugin.transform.call(context, "", file + "?vue&type=style")
    ).toBeUndefined();
});
