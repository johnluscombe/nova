// @vitest-environment jsdom
import type { ImageWorkspaceAPI } from "../../src/types/workspace.ts";
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import type { VueWrapper } from "@vue/test-utils";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import ImageWorkspace from "../../src/components/workspace/ImageWorkspace.vue";
import { activeScenario } from "../../src/composables/useScenario.ts";

let wrapper: VueWrapper<InstanceType<typeof ImageWorkspace>>;
let resize: (
    entries: {
        contentRect: {
            width: number;

            height: number;
        };
    }[]
) => void;
const disconnect = vi.fn();

/**
 * Dispatch a pointer event with explicit coordinates and flush Vue
 * updates.
 */
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

/**
 * Mount a workspace with deterministic canvas bounds and expose its public
 * controller.
 */
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

test("CPHD image formation opens a loading widget and keeps the source", async () => {
    const api = workspace();
    let resolve!: (value: typeof image) => void;
    const formSicd = vi.fn(
        () =>
            new Promise<typeof image>(done => {
                resolve = done;
            })
    );

    window.images = { formSicd } as unknown as NonNullable<Window["images"]>;
    api.add({
        ...image,
        name: "source.cphd",
        path: "/source.cphd",
        pluginId: "nova.sicd",
        metadata: { Format: "CPHD" }
    });
    await nextTick();

    const forming = api.formSicd();

    await nextTick();
    expect(wrapper.text()).toContain("Loading image");
    expect(api.snapshot()).toHaveLength(1);
    resolve({
        ...image,
        name: "formed.sicd",
        path: "/formed.sicd",
        pluginId: "nova.sicd",
        metadata: { Collector: "Radar" }
    });
    await forming;
    await nextTick();
    expect(api.snapshot().map(item => item.path)).toEqual([
        "/source.cphd",
        "/formed.sicd"
    ]);
    expect(wrapper.text()).not.toContain("Loading image");
    expect(formSicd).toHaveBeenCalledWith(
        "/source.cphd",
        "nova.sicd",
        expect.objectContaining({ algorithm: "backprojection" })
    );
});

test("failed image formation keeps the source and excludes the failed placeholder from saved state", async () => {
    const api = workspace();

    window.images = {
        formSicd: vi
            .fn()
            .mockRejectedValue(new Error("Unsupported CPHD geometry"))
    } as unknown as NonNullable<Window["images"]>;
    api.add({
        ...image,
        name: "source.cphd",
        path: "/source.cphd",
        pluginId: "nova.sicd",
        metadata: { Format: "CPHD" }
    });
    await nextTick();
    await api.formSicd();
    await nextTick();
    expect(api.snapshot()).toHaveLength(1);
    expect(wrapper.text()).toContain("Unsupported CPHD geometry");
    expect(wrapper.emitted("scalingError")?.at(-1)).toEqual([
        "Unsupported CPHD geometry"
    ]);
});

test("formation slides select diagnostic previews, disable image tools, and restore their selection", async () => {
    const api = workspace();
    const products = ["input", "windowed", "final"].map(id => ({
        id,
        title: id === "final" ? "Uncalibrated SICD" : id,
        description: `${id} description`,
        previewDataUrl: image.previewDataUrl
    }));
    const formed = {
        ...image,
        pluginId: "nova.sicd",
        formationProducts: products,
        scalingOptions: ["amplitude" as const]
    };

    api.add(formed);
    await nextTick();

    const navigator = wrapper.get('[aria-label="Formation products"]');

    await navigator.get('[aria-label="1. input"]').trigger("click");
    expect(
        wrapper
            .get('[aria-label="Intermediate product preview"] img')
            .attributes("alt")
    ).toBe("input");
    expect(wrapper.emitted("sliceChange")?.at(-1)).toEqual([false]);
    expect(wrapper.emitted("statisticsChange")?.at(-1)).toEqual([false]);
    expect(
        api.snapshot().find(item => item.formationProductId === "input")
    ).toBeDefined();

    const savedProducts = api.snapshot();

    api.hydrate(savedProducts.map(item => ({ ...item, image, loading: true })));

    for (const saved of savedProducts) {
        api.complete(saved.id, formed);
    }

    await nextTick();
    expect(
        wrapper.get('[aria-label="1. input"]').attributes("aria-current")
    ).toBe("step");
    await wrapper
        .get('[aria-label="1. input"]')
        .trigger("keydown", { key: "End" });
    await nextTick();
    expect(
        wrapper.find('[aria-label="Intermediate product preview"]').exists()
    ).toBe(true);
    expect(api.snapshot()).toHaveLength(2);
    expect(api.snapshot()[0]!.formationProductId).toBeUndefined();
    expect(wrapper.emitted("sliceChange")?.at(-1)).toEqual([true]);
    expect(
        wrapper
            .get('[aria-label="3. Uncalibrated SICD"]')
            .attributes("aria-current")
    ).toBe("step");
});

test("formation sidebar closes and reopens independently of the image and selected slide", async () => {
    const api = workspace();

    api.add({
        ...image,
        formationProducts: [
            {
                id: "input",
                title: "Input phase history",
                description: "Source samples",
                previewDataUrl: image.previewDataUrl
            },
            {
                id: "final",
                title: "Uncalibrated SICD",
                description: "Final image",
                previewDataUrl: image.previewDataUrl
            }
        ]
    });
    await nextTick();
    await wrapper.get('[aria-label="1. Input phase history"]').trigger("click");
    await wrapper
        .get('[aria-label="Close formation products"]')
        .trigger("click");
    expect(wrapper.find('[aria-label="Formation products"]').exists()).toBe(
        false
    );
    expect(api.snapshot()).toHaveLength(2);
    expect(
        api.snapshot().find(item => item.formationProductId === "input")
    ).toBeDefined();
    expect(
        wrapper
            .get('[aria-label="Intermediate product preview"] img')
            .attributes("alt")
    ).toBe("Input phase history");
    await wrapper
        .get('[aria-label="Show formation products"]')
        .trigger("click");
    expect(
        wrapper
            .get('[aria-label="1. Input phase history"]')
            .attributes("aria-current")
    ).toBe("step");
});

test("formation navigator stays available on other windows and opens distinct product windows", async () => {
    const api = workspace();
    const products = ["input", "windowed", "final"].map(id => ({
        id,
        title: id,
        description: id,
        previewDataUrl: image.previewDataUrl
    }));

    api.add({ ...image, formationProducts: products });
    await nextTick();
    await wrapper.get('[aria-label="1. input"]').trigger("click");
    await wrapper.get('[aria-label="2. windowed"]').trigger("click");
    expect(api.snapshot()).toHaveLength(3);
    api.add({ ...image, name: "other.png", path: "/other.png" });
    await nextTick();
    expect(wrapper.find('[aria-label="Formation products"]').exists()).toBe(
        true
    );
    await wrapper.get('[aria-label="1. input"]').trigger("click");
    expect(api.snapshot()).toHaveLength(4);
    expect(
        wrapper.findAll('[aria-label="Intermediate product preview"]')
    ).toHaveLength(2);
    await wrapper.get('[aria-label="Close image.test"]').trigger("click");
    expect(wrapper.find('[aria-label="Formation products"]').exists()).toBe(
        true
    );
    await wrapper.get('[aria-label="3. final"]').trigger("click");
    expect(api.snapshot()).toHaveLength(4);
});

test("SIDD creation keeps the source SICD and opens the derived image in another widget", async () => {
    const api = workspace();
    const createSidd = vi.fn().mockResolvedValue({
        ...image,
        name: "detected.sidd",
        path: "/detected.sidd",
        metadata: { Format: "SIDD / NITF" }
    });

    window.images = { createSidd } as unknown as NonNullable<Window["images"]>;
    api.add({
        ...image,
        pluginId: "nova.sicd",
        metadata: { Format: "SICD / NITF" }
    });
    await nextTick();
    expect(wrapper.emitted("imageContextChange")?.at(-1)?.[0]).toMatchObject({
        canCreateSidd: true
    });
    await api.createSidd();
    await nextTick();
    expect(createSidd).toHaveBeenCalledWith(
        image.path,
        "nova.sicd",
        expect.objectContaining({ version: 3 })
    );
    expect(api.snapshot().map(item => item.path)).toEqual([
        image.path,
        "/detected.sidd"
    ]);
    expect(wrapper.emitted("imageContextChange")?.at(-1)?.[0]).toMatchObject({
        canCreateSidd: false
    });
});

test("cropping opens a separate widget and retains the original image", async () => {
    const api = workspace();
    const crop = vi.fn().mockResolvedValue({
        ...image,
        name: "image-crop.png",
        path: "/image-crop.png",
        width: 8,
        height: 6
    });

    window.images = { crop } as unknown as NonNullable<Window["images"]>;
    api.add({ ...image, supportsCrop: true });
    await nextTick();
    api.toggleCrop();
    await nextTick();
    expect(wrapper.emitted("cropChange")?.at(-1)).toEqual([
        { available: true, active: true }
    ]);

    const selection = {
        left: 2,
        top: 3,
        width: 8,
        height: 6,
        sourceWidth: 80,
        sourceHeight: 40
    };

    wrapper
        .findComponent({ name: "ImageSliceView" })
        .vm.$emit("crop", selection);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(crop).toHaveBeenCalledWith(image.path, image.pluginId, selection);
    expect(api.snapshot().map(item => item.path)).toEqual([
        image.path,
        "/image-crop.png"
    ]);
});

test("saving targets the active ready image and reports failures without blocking later saves", async () => {
    let rejectSave: (error: Error) => void = () => {};
    const save = vi.fn(
        () =>
            new Promise<string | null>((_resolve, reject) => {
                rejectSave = reject;
            })
    );

    vi.stubGlobal("images", { save });
    const api = workspace();
    const id = api.add(image, true);

    await api.saveImage();
    expect(save).not.toHaveBeenCalled();
    api.complete(id, image);
    const pending = api.saveImage();

    await api.saveImage();
    expect(save).toHaveBeenCalledExactlyOnceWith(image.path, {
        pluginId: image.pluginId
    });
    rejectSave(new Error("Disk full"));
    await pending;
    expect(wrapper.emitted("scalingError")?.at(-1)).toEqual(["Disk full"]);
    save.mockResolvedValueOnce(null);
    await api.saveImage();
    expect(save).toHaveBeenLastCalledWith(image.path, {
        pluginId: image.pluginId
    });
});
