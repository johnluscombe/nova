export interface WindowRect {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface CanvasSize {
    width: number;
    height: number;
}
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
