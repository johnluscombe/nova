// @vitest-environment jsdom
import type { ImageWorkspaceAPI } from "../../src/types/workspace.ts";
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import type { VueWrapper } from "@vue/test-utils";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import ImageWorkspace from "../../src/components/ImageWorkspace.vue";
import { activeScenario } from "../../src/composables/useScenario.ts";
let wrapper: VueWrapper<InstanceType<typeof ImageWorkspace>>;
let resize: (
    entries: { contentRect: { width: number; height: number } }[]
) => void;
const disconnect = vi.fn();
async function pointer(
    target: { element: Element },
    type: string,
    properties: Record<string, number> = {}
) {
    const event = new Event(type, { bubbles: true });
    for (const [name, value] of Object.entries(properties)) {
        Object.defineProperty(event, name, { value });
    }
    target.element.dispatchEvent(event);
    await nextTick();
}
beforeEach(() => {
    vi.stubGlobal(
        "ResizeObserver",
        class {
            constructor(callback: typeof resize) {
                resize = callback;
            }
            observe() {
                resize([{ contentRect: { width: 1000, height: 700 } }]);
            }
            disconnect = disconnect;
        }
    );
});
afterEach(() => {
    wrapper?.unmount();
    vi.unstubAllGlobals();
    activeScenario.value = null;
});
function workspace() {
    wrapper = mount(ImageWorkspace, {
        global: {
            stubs: {
                QBtn: {
                    props: ["label"],
                    emits: ["click"],
                    template:
                        "<button @click=\"$emit('click')\">{{ label }}</button>"
                },
                QIcon: true,
                QSpinner: true
            }
        }
    });
    return wrapper.vm as unknown as ImageWorkspaceAPI;
}
const image = {
    name: "image.test",
    path: "/image.test",
    pluginId: "test",
    pluginName: "Test",
    width: 80,
    height: 40,
    statistics: { Mean: 2 },
    metadata: { Collector: "Radar" },
    previewDataUrl: "data:image/png;base64,eA=="
};

test("panels follow image readiness and closing a widget ignores late completion", async () => {
    const api = workspace();
    expect(wrapper.text()).toContain("Create or open a scenario");
    activeScenario.value = { name: "Test", path: "/test.scenario", tables: [] };
    await nextTick();
    expect(wrapper.text()).toContain("Open an image");
    const id = api.add({ ...image, previewDataUrl: "" }, true);
    await nextTick();
    expect(wrapper.text()).toContain("Loading image");
    api.toggleMetadata();
    api.toggleStatistics();
    await nextTick();
    expect(wrapper.find('[aria-label="Image statistics"]').exists()).toBe(
        false
    );
    api.complete(id, image);
    await nextTick();
    api.toggleStatistics();
    await nextTick();
    expect(wrapper.get('[aria-label="Image statistics"]').text()).toContain(
        "2"
    );
    expect(wrapper.get('[aria-label="Image metadata"]').text()).toContain(
        "Radar"
    );
    await wrapper.get('[aria-label="Close statistics"]').trigger("click");
    await wrapper.get('[aria-label="Close metadata"]').trigger("click");
    await wrapper.get('[aria-label="Close image.test"]').trigger("click");
    api.complete(id, image);
    api.fail(id, "late failure");
    api.toggleMetadata();
    api.toggleStatistics();
    await nextTick();
    expect(api.snapshot()).toEqual([]);
});

test("hydration preserves window state, failure placeholders and resizes to the canvas", async () => {
    const api = workspace();
    api.hydrate([
        {
            id: 4,
            path: image.path,
            pluginId: image.pluginId,
            image: { ...image, previewDataUrl: "" },
            rect: { x: 100, y: 100, width: 520, height: 360 },
            z: 5,
            minimized: false,
            maximized: true,
            error: "Missing image"
        }
    ]);
    await nextTick();
    expect(wrapper.text()).toContain("Missing image");
    expect(api.snapshot()[0]).toMatchObject({ id: 4, z: 5, maximized: true });
    api.fail(4, "Decoder failed");
    await nextTick();
    expect(wrapper.text()).toContain("Decoder failed");
    resize([]);
    resize([{ contentRect: { width: 300, height: 200 } }]);
    await nextTick();
    expect(api.snapshot()[0]!.rect).toEqual({
        x: 0,
        y: 0,
        width: 300,
        height: 200
    });
    const next = api.add(image);
    expect(next).toBe(5);
    await nextTick();
    await wrapper.get('[aria-label="Minimize image.test"]').trigger("click");
});

test("pointer gestures distinguish move and resize and ignore wrong pointers", async () => {
    const api = workspace();
    api.add(image);
    await nextTick();
    const title = wrapper.get(".widget-titlebar");
    title.element.setPointerCapture = vi.fn();
    await pointer(title, "pointerdown", { button: 2, pointerId: 1 });
    await pointer(title, "pointermove", {
        pointerId: 1,
        clientX: 20,
        clientY: 20
    });
    const initial = api.snapshot()[0]!.rect;
    await pointer(title, "pointerdown", {
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0
    });
    await pointer(title, "pointermove", {
        pointerId: 2,
        clientX: 90,
        clientY: 90
    });
    expect(api.snapshot()[0]!.rect).toEqual(initial);
    await pointer(title, "pointermove", {
        pointerId: 1,
        clientX: 20,
        clientY: 20
    });
    await pointer(title, "pointerup");
    expect(api.snapshot()[0]!.rect.x).toBe(initial.x + 20);
    await title.trigger("keydown", { key: "ArrowLeft" });
    const handle = wrapper.get(".resize-se");
    handle.element.setPointerCapture = vi.fn();
    const width = api.snapshot()[0]!.rect.width;
    await pointer(handle, "pointerdown", {
        button: 0,
        pointerId: 3,
        clientX: 0,
        clientY: 0
    });
    await pointer(handle, "pointermove", {
        pointerId: 3,
        clientX: 20,
        clientY: 20
    });
    await pointer(handle, "pointercancel");
    expect(api.snapshot()[0]!.rect.width).toBe(width + 20);
});

test("clearing a region ignores late statistics and restores the whole-image panel", async () => {
    const api = workspace();
    let finish:
        | ((result: import("../../src/types/region").RegionStatistics) => void)
        | undefined;
    const region = vi.fn(
        () =>
            new Promise<import("../../src/types/region").RegionStatistics>(
                resolve => {
                    finish = resolve;
                }
            )
    );
    window.images = {
        region
    } as unknown as import("../../src/types/image").ImageAPI;
    try {
        api.add({ ...image, supportsSourceRegions: true });
        await nextTick();
        const points = [
            { row: 0, column: 0 },
            { row: 0, column: 2 },
            { row: 2, column: 2 },
            { row: 2, column: 0 }
        ];
        wrapper
            .getComponent({ name: "ImageSliceView" })
            .vm.$emit("region", points);
        await nextTick();
        expect(api.snapshot()[0]?.region).toEqual(points);
        expect(region).toHaveBeenCalledOnce();
        await api.clearRegion();
        finish!({
            statistics: { "50th percentile": 999 },
            valueLabel: "Source amplitude",
            sampleCount: 4,
            sampled: false
        });
        await Promise.resolve();
        await nextTick();
        expect(api.snapshot()[0]?.region).toBeUndefined();
        expect(
            wrapper.get('[aria-label="Image statistics"]').text()
        ).not.toContain("999");
        expect(
            wrapper.get('[aria-label="Image statistics"]').text()
        ).not.toContain("Region statistics");
    } finally {
        delete window.images;
    }
});
