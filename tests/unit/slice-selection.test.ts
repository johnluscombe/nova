import { test, expect } from "vitest";
import { sliceAtOffset } from "../../src/utils/image-slice";

test("slice selection maps rendered offsets to source pixels and excludes letterboxing", () => {
    expect(sliceAtOffset(25, 25, 200, 4096)).toBe(0);
    expect(sliceAtOffset(125, 25, 200, 4096)).toBe(2048);
    expect(sliceAtOffset(224.99, 25, 200, 4096)).toBe(4095);
    expect(sliceAtOffset(24, 25, 200, 4096)).toBeNull();
    expect(sliceAtOffset(225, 25, 200, 4096)).toBeNull();
    expect(sliceAtOffset(1, 0, 0, 20)).toBeNull();
    expect(sliceAtOffset(1, 0, 20, 0)).toBeNull();
    expect(sliceAtOffset(NaN, 0, 20, 10)).toBeNull();
});
