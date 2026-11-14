// @vitest-environment jsdom
/* oxlint-disable typescript/unbound-method -- Assertions inspect mocked IPC methods without invoking them. */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
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
vi.mock("../../src/components/ImageWorkspace.vue", () => ({
    default: defineComponent({
        setup(_, { expose }) {
            expose(workspace);
            return () => h("div", "Workspace");
        }
    })
}));
import IndexPage from "../../src/pages/IndexPage.vue";
let wrapper, flush;
const scenario = { name: "Test", path: "/test.scenario", tables: [] };
const image = {
    name: "image",
    path: "/image",
    pluginId: "test",
    pluginName: "Test"
};
const container = { template: "<div><slot /></div>" };
const stubs = Object.fromEntries(
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
    window.images = {
        plugins: vi.fn(async () => ({
            directory: "/plugins",
            plugins: [{ id: "test", extensions: ["test"] }],
            errors: []
        })),
        open: vi.fn(async () => image),
        executeRibbonAction: vi.fn(async () => ({}))
    };
    window.scenario = {
        restoreLast: vi.fn(async () => null),
        saveWorkspace: vi.fn(async () => {}),
        onFlushRequested: vi.fn(callback => {
            flush = callback;
            return vi.fn();
        }),
        confirmClose: vi.fn(async () => {}),
        create: vi.fn(async () => scenario),
        open: vi.fn(async () => scenario),
        close: vi.fn(async () => {}),
        loadImages: vi.fn(async () => {})
    };
});
afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    activeScenario.value = null;
    delete window.images;
    delete window.scenario;
});
async function page() {
    wrapper = mount(IndexPage, { global: { stubs } });
    await flushPromises();
    return wrapper;
}
async function click(label) {
    await wrapper
        .findAll("button")
        .find(button => button.text() === label)
        .trigger("click");
    await flushPromises();
}

test("restored image updates complete or fail the saved widgets", async () => {
    window.scenario.restoreLast.mockResolvedValue({
        ...scenario,
        workspace: [{ id: 1, loading: true }]
    });
    window.scenario.loadImages.mockImplementation(async callback => {
        callback({ id: 1, image });
        callback({ id: 2 });
    });
    await page();
    expect(workspace.hydrate).toHaveBeenCalled();
    expect(workspace.complete).toHaveBeenCalledWith(1, image);
    expect(workspace.fail).toHaveBeenCalledWith(2, "Unable to restore image.");
    flush();
    await flushPromises();
    expect(window.scenario.confirmClose).toHaveBeenCalledOnce();
});

test("image opening handles plugins that return directly or announce loading first", async () => {
    await page();
    await click("New");
    await click("Open");
    expect(window.scenario.open).toHaveBeenCalledOnce();
    // Image Open has the same label as scenario Open; select it by aria-label.
    await wrapper.get('[aria-label="Open image"]').trigger("click");
    await flushPromises();
    expect(workspace.add).toHaveBeenCalledWith(image);
    window.images.open.mockImplementation(async callback => {
        callback(image);
        return image;
    });
    await wrapper.get('[aria-label="Open image"]').trigger("click");
    await flushPromises();
    expect(workspace.complete).toHaveBeenCalledWith(1, image);
    window.images.open.mockImplementation(async callback => {
        callback(image);
        throw "decode failed";
    });
    await wrapper.get('[aria-label="Open image"]').trigger("click");
    await flushPromises();
    expect(workspace.fail).toHaveBeenCalledWith(1, "Unable to open image.");
    await click("Close");
    expect(activeScenario.value).toBeNull();
});

test("missing desktop APIs provide actionable errors", async () => {
    delete window.images;
    delete window.scenario;
    await page();
    await click("New");
    expect(wrapper.text()).toContain(
        "Use the Nova desktop app to create scenarios"
    );
    await click("Open");
    expect(wrapper.text()).toContain("Open scenarios in the Nova desktop app");
});

test("unknown error values have readable plugin and session error messages", async () => {
    window.images.plugins.mockRejectedValue("plugins failed");
    window.scenario.restoreLast.mockRejectedValue("restore failed");
    await page();
    expect(wrapper.text()).toContain("Unable to restore scenario.");
    window.scenario.create.mockRejectedValue("create failed");
    await click("New");
    expect(wrapper.text()).toContain("Unable to create scenario.");
    window.scenario.open.mockRejectedValue("open failed");
    await click("Open");
    expect(wrapper.text()).toContain("Unable to open scenario.");
});

test("failed saves keep work open and prevent confirming application shutdown", async () => {
    window.scenario.restoreLast.mockResolvedValue(scenario);
    await page();
    window.scenario.saveWorkspace.mockRejectedValue("disk full");
    flush();
    await flushPromises();
    expect(window.scenario.confirmClose).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Unable to save before closing");
    await click("Close");
    expect(window.scenario.close).not.toHaveBeenCalled();
    expect(activeScenario.value).toEqual(scenario);
});
