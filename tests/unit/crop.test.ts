import { test, expect } from "vitest";
import { validateCrop } from "../../src/types/crop";
const rectangle = {
    left: 2,
    top: 3,
    width: 8,
    height: 6,
    sourceWidth: 16,
    sourceHeight: 12
};
test("crop bounds use integer source pixels and authoritative source dimensions", () => {
    expect(validateCrop(rectangle, 16, 12)).toEqual(rectangle);
    expect(validateCrop(rectangle)).toEqual(rectangle);
    for (const patch of [
        { left: -1 },
        { top: NaN },
        { width: 0 },
        { height: 1.5 },
        { width: 16 },
        { sourceWidth: 20 }
    ]) {
        expect(() => validateCrop({ ...rectangle, ...patch }, 16, 12)).toThrow(
            /inside the image/
        );
    }
});
