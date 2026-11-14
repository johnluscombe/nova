import { test } from "vitest";
import assert from "node:assert/strict";
import { fitWindow, resizeWindow } from "../../src/utils/window-geometry.ts";

test("windows stay reachable when moved off canvas or the canvas shrinks", () => {
    assert.deepEqual(
        fitWindow(
            { x: -100, y: 900, width: 500, height: 300 },
            { width: 800, height: 600 }
        ),
        { x: 0, y: 300, width: 500, height: 300 }
    );
    assert.deepEqual(
        fitWindow(
            { x: 400, y: 300, width: 500, height: 300 },
            { width: 200, height: 100 }
        ),
        { x: 0, y: 0, width: 200, height: 100 }
    );
});

test("all resize edges enforce minimum size and canvas boundaries", () => {
    const bounds = { width: 800, height: 600 };
    const rect = { x: 100, y: 100, width: 400, height: 300 };
    for (const edge of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
        for (const dx of [-2000, 2000]) {
            for (const dy of [-2000, 2000]) {
                const next = resizeWindow(rect, edge, dx, dy, bounds);
                assert.ok(next.x >= 0 && next.y >= 0);
                assert.ok(next.width >= 260 && next.height >= 180);
                assert.ok(next.x + next.width <= bounds.width);
                assert.ok(next.y + next.height <= bounds.height);
                if (edge.includes("w")) {
                    assert.equal(next.x + next.width, 500);
                }
                if (edge.includes("n")) {
                    assert.equal(next.y + next.height, 400);
                }
            }
        }
    }
});
