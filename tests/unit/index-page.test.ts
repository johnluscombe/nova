// @vitest-environment jsdom
/* oxlint-disable typescript/unbound-method -- Assertions inspect mocked IPC methods without invoking them. */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import type { VueWrapper } from "@vue/test-utils";
import type { Component } from "vue";
import type { Mocked } from "vitest";
import type { ImageAPI } from "../../src/types/image.ts";
import type { ScenarioAPI } from "../../src/types/scenario.ts";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { activeScenario } from "../../src/composables/useScenario.ts";

const workspace = vi.hoisted(() => ({
    add: vi.fn(() => 1),
    complete: vi.fn(),
    fail: vi.fn(),
    hydrate: vi.fn(),
    snapshot: vi.fn(() => []),
    toggleMetadata: vi.fn(),
    toggleStatistics: vi.fn()
}));

vi.mock("../../src/components/workspace/ImageWorkspace.vue", () => ({
    default: defineComponent({
        name: "ImageWorkspace",

        /**
         * Install isolated desktop API mocks for the page test.
         */
        setup(_, { expose }) {
            expose(workspace);

            return () => h("div", "Workspace");
        }
    })
}));
import IndexPage from "../../src/pages/IndexPage.vue";

let wrapper: VueWrapper<InstanceType<typeof IndexPage>> | undefined;
let flush: () => void;
let scenarioMock: Mocked<ScenarioAPI>;
let imagesMock: Mocked<ImageAPI>;
const scenario = { name: "Test", path: "/test.scenario", tables: [] };
const image = {
    name: "image",
    path: "/image",
    pluginId: "test",
    pluginName: "Test"
};
const container = { template: "<div><slot /></div>" };
const stubs: Record<string, Component> = Object.fromEntries(
    [
        "QPage",
        "QTabs",
        "QTab",
        "QSeparator",
        "QLinearProgress",
        "QCard",
        "QCardSection",
        "QCardActions",
        "QBanner"
    ].map(name => [name, container])
);

stubs.QTabs = {
    name: "QTabs",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: "<div><slot /></div>"
};
stubs.QTab = {
    name: "QTab",
    props: ["name", "label"],
    template: "<span>{{ label }}</span>"
};
stubs.QBtn = {
    props: ["label", "disable"],
    emits: ["click"],
    template:
        '<button :disabled="disable" @click="$emit(\'click\')">{{ label }}</button>'
};
stubs.QDialog = {
    props: ["modelValue"],
    template: '<div v-if="modelValue"><slot /></div>'
};
beforeEach(() => {
    vi.clearAllMocks();
    activeScenario.value = null;
    imagesMock = {
        crop: vi.fn(),
        createSidd: vi.fn(),
        formSicd: vi.fn(),
        region: vi.fn(),
        attachMetadata: vi.fn(),
        importFiles: vi.fn(async (onUpdate, paths) => {
            const selected = Array.isArray(paths) ? paths : [paths];

            for (const [index, file] of selected.entries()) {
                const image = await imagesMock.open(image => {
                    onUpdate({ key: String(index), status: "loading", image });
                }, file);

                if (image) {
                    onUpdate({ key: String(index), status: "ready", image });
                }
            }

            return { errors: [] };
        }),
        pixel: vi.fn(),
        rescale: vi.fn(),
        pathForFile: vi.fn(file => file.name),
        slice: vi.fn(),
        plugins: vi.fn<ImageAPI["plugins"]>(async () => ({
            directory: "/plugins",
            plugins: [
                {
                    apiVersion: 1,
                    id: "test",
                    name: "Test",
                    main: "index.ts",
                    extensions: ["test"]
                }
            ],
            errors: []
        })),
        open: vi.fn<ImageAPI["open"]>(async () => image),
        executeRibbonAction: vi.fn(async () => ({}))
    };
    scenarioMock = {
        restoreLast: vi.fn<ScenarioAPI["restoreLast"]>(async () => null),
        saveWorkspace: vi.fn(async () => {}),
        onFlushRequested: vi.fn<ScenarioAPI["onFlushRequested"]>(callback => {
            flush = callback;

            return vi.fn();
        }),
        confirmClose: vi.fn(async () => {}),
        create: vi.fn(async () => scenario),
        open: vi.fn(async () => scenario),
        close: vi.fn(async () => {}),
        loadImages: vi.fn<ScenarioAPI["loadImages"]>(async () => {}),
        readTable: vi.fn(async () => ({
            columns: [],
            rows: [],
            hasMore: false
        }))
    };
    window.scenario = scenarioMock;
    window.images = imagesMock;
});
afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    activeScenario.value = null;
    delete window.images;
    Reflect.deleteProperty(window, "scenario");
});

/**
 * Mount the scenario page with stubbed workspace and Quasar controls.
 */
async function page() {
    wrapper = mount(IndexPage, { global: { stubs } });
    await flushPromises();

    return wrapper;
}

/**
 * Click the named ribbon control and flush asynchronous Vue work.
 */
async function click(label: string) {
    await wrapper!
        .findAll("button")
        .find(button => button.text() === label)!
        .trigger("click");
    await flushPromises();
}

test("restored image updates complete or fail the saved widgets", async () => {
    scenarioMock.restoreLast.mockResolvedValue({
        ...scenario,
        workspace: [
            {
                id: 1,
                loading: true,
                image,
                path: image.path,
                pluginId: image.pluginId,
                rect: { x: 0, y: 0, width: 520, height: 360 },
                z: 1,
                minimized: false,
                maximized: false
            }
        ]
    });
    scenarioMock.loadImages.mockImplementation(async callback => {
        callback({ id: 1, image });
        callback({ id: 2 });
    });
    await page();
    expect(workspace.hydrate).toHaveBeenCalled();
    expect(workspace.complete).toHaveBeenCalledWith(1, image);
    expect(workspace.fail).toHaveBeenCalledWith(2, "Unable to restore image.");
    flush();
    await flushPromises();
    expect(scenarioMock.confirmClose).toHaveBeenCalledOnce();
});

test("image opening handles plugins that return directly or announce loading first", async () => {
    await page();
    await click("New");
    await click("Open");
    expect(scenarioMock.open).toHaveBeenCalledOnce();
    await wrapper!.get('[aria-label="Add Image"]').trigger("click");
    await flushPromises();
    expect(workspace.add).toHaveBeenCalledWith(image);
    imagesMock.open.mockImplementation(async callback => {
        callback?.(image);

        return image;
    });
    await wrapper!.get('[aria-label="Add Image"]').trigger("click");
    await flushPromises();
    expect(workspace.complete).toHaveBeenCalledWith(1, image);
    imagesMock.open.mockImplementation(async callback => {
        callback?.(image);

        throw "decode failed";
    });
    await wrapper!.get('[aria-label="Add Image"]').trigger("click");
    await flushPromises();
    expect(workspace.fail).toHaveBeenCalledWith(1, "Unable to open image.");
    await click("Close");
    expect(activeScenario.value).toBeNull();
});

test("missing desktop APIs provide actionable errors", async () => {
    delete window.images;
    Reflect.deleteProperty(window, "scenario");
    await page();
    await click("New");
    expect(wrapper!.text()).toContain(
        "Use the Nova desktop app to create scenarios"
    );
    await click("Open");
    expect(wrapper!.text()).toContain("Open scenarios in the Nova desktop app");
});

test("unknown error values have readable plugin and session error messages", async () => {
    imagesMock.plugins.mockRejectedValue("plugins failed");
    scenarioMock.restoreLast.mockRejectedValue("restore failed");
    await page();
    expect(wrapper!.text()).toContain("Unable to restore scenario.");
    scenarioMock.create.mockRejectedValue("create failed");
    await click("New");
    expect(wrapper!.text()).toContain("Unable to create scenario.");
    scenarioMock.open.mockRejectedValue("open failed");
    await click("Open");
    expect(wrapper!.text()).toContain("Unable to open scenario.");
});

test("failed saves keep work open and prevent confirming application shutdown", async () => {
    scenarioMock.restoreLast.mockResolvedValue(scenario);
    await page();
    scenarioMock.saveWorkspace.mockRejectedValue("disk full");
    flush();
    await flushPromises();
    expect(scenarioMock.confirmClose).not.toHaveBeenCalled();
    expect(wrapper!.text()).toContain("Unable to save before closing");
    await click("Close");
    expect(scenarioMock.close).not.toHaveBeenCalled();
    expect(activeScenario.value).toEqual(scenario);
});

/**
 * Dispatch a native-style file drop into the page test.
 */
async function drop(...names: string[]) {
    const event = new Event("drop", { cancelable: true });

    Object.defineProperty(event, "dataTransfer", {
        value: { files: names.map(name => new File([""], name)) }
    });
    window.dispatchEvent(event);
    await flushPromises();
    expect(event.defaultPrevented).toBe(true);
}

test("file drops open the scenario first and then each image without dialogs", async () => {
    await page();
    await drop("first.test", "workspace.SCENARIO", "second.test");
    expect(scenarioMock.open).toHaveBeenCalledWith("workspace.SCENARIO");
    expect(imagesMock.open).toHaveBeenNthCalledWith(
        1,
        expect.any(Function),
        "first.test"
    );
    expect(imagesMock.open).toHaveBeenNthCalledWith(
        2,
        expect.any(Function),
        "second.test"
    );
    expect(workspace.add).toHaveBeenCalledTimes(2);
});

test("drops explain the missing scenario and reject multiple scenarios", async () => {
    await page();
    await drop("image.test");
    expect(wrapper!.text()).toContain(
        "Open or create a scenario before opening images."
    );
    expect(imagesMock.open).not.toHaveBeenCalled();
    await drop("a.scenario", "b.scenario");
    expect(wrapper!.text()).toContain("Drop one scenario at a time.");
    expect(scenarioMock.open).not.toHaveBeenCalled();
    await drop("a.scenario");
    expect(scenarioMock.open).toHaveBeenCalledWith("a.scenario");
});

test("image drops keep the existing loading and failure behavior", async () => {
    scenarioMock.restoreLast.mockResolvedValue(scenario);
    imagesMock.open.mockImplementation(async onLoading => {
        onLoading?.(image);

        throw new Error("Unable to decode dropped image");
    });
    await page();
    await drop("broken.test");
    expect(workspace.add).toHaveBeenCalledWith(image, true);
    expect(workspace.fail).toHaveBeenCalledWith(
        1,
        "Unable to decode dropped image"
    );
    wrapper!.unmount();
    wrapper = undefined;
    window.dispatchEvent(new Event("drop"));
    expect(scenarioMock.open).not.toHaveBeenCalled();
});

test("contextual image tabs organize View, Edit, and Analysis controls", async () => {
    await page();

    const labels = () =>
        wrapper!.findAll("button").map(button => button.text());

    expect(labels()).not.toContain("Metadata");
    expect(labels()).not.toContain("Slice");
    expect(labels()).not.toContain("Statistics");

    const workspaceComponent = wrapper!.getComponent({
        name: "ImageWorkspace"
    });

    workspaceComponent.vm.$emit("imageContextChange", {
        available: true,
        scientific: true
    });
    await flushPromises();
    expect(wrapper!.text()).toContain("Scientific Imagery");
    wrapper!
        .getComponent({ name: "QTabs" })
        .vm.$emit("update:modelValue", "image-tools");
    await flushPromises();
    expect(
        wrapper!.get('[aria-labelledby="data-group-label"]').text()
    ).toContain("Attach Metadata");
    expect(
        wrapper!.get('[aria-labelledby="edit-group-label"]').text()
    ).toContain("Scaling");
    expect(labels()).toContain("Slice");
    expect(
        wrapper!.get('[aria-labelledby="view-group-label"]').text()
    ).toContain("Statistics");

    for (const label of ["Metadata", "Axes", "Pixel Values", "Statistics"]) {
        expect(
            wrapper!.get('[aria-labelledby="view-group-label"]').text()
        ).toContain(label);
    }

    expect(
        wrapper!.get('[aria-labelledby="edit-group-label"]').text()
    ).toContain("Crop");

    for (const label of ["Slice", "Polygon", "Clear Region"]) {
        expect(
            wrapper!.get('[aria-labelledby="analysis-group-label"]').text()
        ).toContain(label);
    }

    expect(labels()).toContain("Metadata");
    workspaceComponent.vm.$emit("imageContextChange", {
        available: true,
        scientific: false
    });
    await flushPromises();
    expect(wrapper!.text()).not.toContain("Scientific Imagery");
    expect(
        wrapper!
            .findAllComponents({ name: "QTab" })
            .some(tab => tab.props("label") === "Image")
    ).toBe(true);
    workspaceComponent.vm.$emit("imageContextChange", {
        available: false,
        scientific: false
    });
    await flushPromises();
    expect(labels()).not.toContain("Metadata");
    expect(labels()).not.toContain("Slice");
    expect(labels()).not.toContain("Statistics");
});
