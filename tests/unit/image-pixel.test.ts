// @vitest-environment jsdom
import { test, expect, vi, afterEach } from "vitest";
import { nextTick } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import type { VueWrapper } from "@vue/test-utils";
import type { ImageAPI, ImageInfo } from "../../src/types/image";
import type { PixelData } from "../../src/types/pixel";
import ImageSliceView from "../../src/components/image/ImageSliceView.vue";

let wrapper: VueWrapper;
const image: ImageInfo = {
    name: "radar.nitf",
    path: "/radar.nitf",
    pluginId: "sicd",
    pluginName: "SICD",
    width: 10,
    height: 5,
    previewDataUrl: "data:image/png;base64,eA==",
    supportsSourcePixels: true,
    scaling: "real"
};

/**
 * Mount the fitted image view with deterministic viewport geometry.
 */
async function view(pixel: ImageAPI["pixel"]) {
    vi.useFakeTimers();
    window.images = { pixel } as ImageAPI;
    vi.stubGlobal(
        "ResizeObserver",
        class {
            callback: (
                entries: {
                    contentRect: {
                        width: number;

                        height: number;
                    };
                }[]
            ) => void;
            constructor(
                callback: (
                    entries: {
                        contentRect: {
                            width: number;

                            height: number;
                        };
                    }[]
                ) => void
            ) {
                this.callback = callback;
            }
            observe() {
                this.callback([{ contentRect: { width: 100, height: 100 } }]);
            }
            disconnect() {}
        }
    );
    wrapper = mount(ImageSliceView, {
        props: { image, enabled: false, inspect: true }
    });

    const img = wrapper.get("img");

    Object.defineProperties(img.element, {
        naturalWidth: { value: 10 },
        naturalHeight: { value: 5 }
    });
    await img.trigger("load");
}

/**
 * Move the simulated pointer to a source position and flush the debounced
 * inspection work.
 */
async function hover(x: number, y: number) {
    wrapper.get(".slice-viewport").element.dispatchEvent(
        new MouseEvent("pointermove", {
            clientX: x,
            clientY: y,
            bubbles: true
        })
    );
    await nextTick();
}

afterEach(() => {
    wrapper?.unmount();
    delete window.images;
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

test("pixel hover maps fitted image coordinates, coalesces movement and ignores letterboxing", async () => {
    const pixel = vi
        .fn<ImageAPI["pixel"]>()
        .mockResolvedValue({ value: -3, valueLabel: "Real component" });

    await view(pixel);
    await hover(15, 30);
    await hover(35, 40);
    await vi.advanceTimersByTimeAsync(150);
    expect(pixel).toHaveBeenCalledExactlyOnceWith(
        "/radar.nitf",
        "sicd",
        1,
        3,
        "real"
    );
    expect(wrapper.text()).toContain("Row 1 · Column 3");
    expect(wrapper.text()).toContain("Real component: -3");
    await hover(35, 10);
    expect(wrapper.find(".pixel-readout").exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(pixel).toHaveBeenCalledTimes(1);
});

test("pixel hover allows one source request at a time and discards late results", async () => {
    const pending: ((data: PixelData) => void)[] = [];
    const pixel = vi.fn<ImageAPI["pixel"]>(
        () => new Promise(resolve => pending.push(resolve))
    );

    await view(pixel);
    await hover(15, 30);
    await vi.advanceTimersByTimeAsync(150);
    await hover(65, 65);
    await vi.advanceTimersByTimeAsync(150);
    expect(pixel).toHaveBeenCalledTimes(1);
    pending[0]!({ value: 111, valueLabel: "Old value" });
    await flushPromises();
    expect(pixel).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).not.toContain("111");
    expect(wrapper.text()).toContain("Row 4 · Column 6");
    await wrapper.setProps({ inspect: false });
    pending[1]!({ value: 222, valueLabel: "Stale value" });
    await flushPromises();
    expect(wrapper.find(".pixel-readout").exists()).toBe(false);
});

test("pixel hover reports read errors and clears its readout on leave", async () => {
    await view(
        vi
            .fn<ImageAPI["pixel"]>()
            .mockRejectedValue(new Error("Reader unavailable"))
    );
    await hover(15, 30);
    await vi.advanceTimersByTimeAsync(150);
    expect(wrapper.text()).toContain("Reader unavailable");
    await wrapper.get(".slice-viewport").trigger("pointerleave");
    expect(wrapper.find(".pixel-readout").exists()).toBe(false);
});
