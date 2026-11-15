/** Widget position and size in CSS pixels relative to the workspace canvas. */
export interface WindowRect {
    x: number;

    y: number;

    width: number;

    height: number;
}

/**
 * Available workspace extent in CSS pixels, used to constrain widget geometry.
 */
export interface CanvasSize {
    width: number;

    height: number;
}

/**
 * Fit a window rectangle to the canvas while respecting the available
 * space.
 */
export function fitWindow(rect: WindowRect, bounds: CanvasSize): WindowRect {
    const width = Math.min(Math.max(260, rect.width), bounds.width);
    const height = Math.min(Math.max(180, rect.height), bounds.height);

    return {
        width,
        height,
        x: Math.max(0, Math.min(rect.x, bounds.width - width)),
        y: Math.max(0, Math.min(rect.y, bounds.height - height))
    };
}

/**
 * Resize a saved rectangle while respecting minimum size and canvas bounds.
 *
 * @param edge - Compass directions of the dragged handle, such as n, se, or
 * w.
 * @param dx - Horizontal pointer displacement in canvas CSS pixels.
 * @param dy - Vertical pointer displacement in canvas CSS pixels.
 * @returns A new rectangle; the original rectangle is not mutated.
 */
export function resizeWindow(
    rect: WindowRect,
    edge: string,
    dx: number,
    dy: number,
    bounds: CanvasSize
): WindowRect {
    let { x, y, width, height } = rect;
    const right = x + width;
    const bottom = y + height;

    if (edge.includes("e")) {
        width = Math.max(
            Math.min(260, bounds.width),
            Math.min(width + dx, bounds.width - x)
        );
    }

    if (edge.includes("s")) {
        height = Math.max(
            Math.min(180, bounds.height),
            Math.min(height + dy, bounds.height - y)
        );
    }

    if (edge.includes("w")) {
        x = Math.max(0, Math.min(x + dx, right - Math.min(260, bounds.width)));
        width = right - x;
    }

    if (edge.includes("n")) {
        y = Math.max(
            0,
            Math.min(y + dy, bottom - Math.min(180, bounds.height))
        );
        height = bottom - y;
    }

    return { x, y, width, height };
}
