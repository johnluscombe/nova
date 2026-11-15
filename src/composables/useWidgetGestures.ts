import { onMounted, onBeforeUnmount, type Ref } from "vue";
import type { ImageWindow } from "@/types/image-window";
import {
    fitWindow,
    resizeWindow,
    type WindowRect,
    type CanvasSize
} from "@/utils/window-geometry";

/**
 * Own pointer/keyboard geometry changes and resize observation for the
 * workspace canvas.
 */
export function useWidgetGestures(
    canvas: Ref<HTMLDivElement | undefined>,
    windows: Ref<ImageWindow[]>,
    bounds: CanvasSize,
    activate: (widget: ImageWindow) => void,
    onChange: () => void
) {
    let observer: ResizeObserver | undefined;
    let gesture:
        | {
              widget: ImageWindow;

              pointerId: number;

              x: number;

              y: number;

              rect: WindowRect;

              action: string;
          }
        | undefined;

    /**
     * Capture a move or resize gesture and its initial pointer and window
     * coordinates.
     */
    function startGesture(
        event: PointerEvent,
        widget: ImageWindow,
        action: string
    ) {
        if (event.button !== 0 || widget.maximized) {
            return;
        }

        event.preventDefault();
        activate(widget);
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        gesture = {
            widget,
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            rect: { ...widget.rect },
            action
        };
    }

    /**
     * Apply pointer movement to the captured gesture while constraining the
     * window to the canvas.
     */
    function moveGesture(event: PointerEvent) {
        if (!gesture || event.pointerId !== gesture.pointerId) {
            return;
        }

        const { widget, rect, action, x, y } = gesture;
        const dx = event.clientX - x;
        const dy = event.clientY - y;

        widget.rect =
            action === "move"
                ? fitWindow({ ...rect, x: rect.x + dx, y: rect.y + dy }, bounds)
                : resizeWindow(rect, action, dx, dy, bounds);
    }

    /**
     * Release the current gesture and publish the resulting window layout.
     */
    function endGesture() {
        if (gesture) {
            gesture = undefined;
            onChange();
        }
    }

    /**
     * Translate arrow-key input and modifiers into a keyboard movement
     * increment.
     */
    function keyboardDelta(event: KeyboardEvent) {
        const step = event.shiftKey ? 40 : 10;

        return {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step]
        }[event.key];
    }

    /**
     * Move a focused widget title bar with arrow keys while keeping it inside
     * the canvas.
     */
    function moveWithKeyboard(event: KeyboardEvent, widget: ImageWindow) {
        const delta = keyboardDelta(event);

        if (!delta || widget.maximized) {
            return;
        }

        event.preventDefault();
        widget.rect = fitWindow(
            {
                ...widget.rect,
                x: widget.rect.x + delta[0]!,
                y: widget.rect.y + delta[1]!
            },
            bounds
        );
    }

    /**
     * Resize a focused widget edge with arrow keys while preserving its
     * minimum dimensions.
     */
    function resizeWithKeyboard(event: KeyboardEvent, widget: ImageWindow) {
        const delta = keyboardDelta(event);

        if (!delta) {
            return;
        }

        event.preventDefault();
        widget.rect = resizeWindow(
            widget.rect,
            "se",
            delta[0]!,
            delta[1]!,
            bounds
        );
    }

    onMounted(() => {
        observer = new ResizeObserver(entries => {
            const size = entries[0]?.contentRect;

            if (!size) {
                return;
            }

            bounds.width = size.width;
            bounds.height = size.height;
            endGesture();

            for (const widget of windows.value) {
                widget.rect = fitWindow(widget.rect, bounds);
            }
        });

        if (canvas.value) {
            bounds.width = canvas.value.clientWidth;
            bounds.height = canvas.value.clientHeight;
            observer.observe(canvas.value);
        }
    });
    onBeforeUnmount(() => {
        observer?.disconnect();
        endGesture();
    });
    return {
        startGesture,
        moveGesture,
        endGesture,
        moveWithKeyboard,
        resizeWithKeyboard,
        isGesturing: () => !!gesture
    };
}
