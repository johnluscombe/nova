import { test, expect } from "vitest";
import { validateFormationProducts } from "../../src/types/formation";

const final = {
    id: "final",
    title: "Uncalibrated SICD",
    description: "Completed image",
    previewDataUrl: "data:image/png;base64,eA=="
};
test("formation previews validate their protocol and finish with the final product", () => {
    expect(validateFormationProducts([final])).toEqual([final]);
    for (const value of [
        null,
        [],
        [final, final],
        [{ ...final, id: "input" }],
        [{ ...final, title: "" }],
        [{ ...final, previewDataUrl: "https://example.com/preview.png" }],
        [{ ...final, description: null }]
    ]) {
        expect(() => validateFormationProducts(value)).toThrow();
    }
});
