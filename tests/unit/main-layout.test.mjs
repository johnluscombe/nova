// @vitest-environment jsdom
import { test, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import MainLayout from "../../src/layouts/MainLayout.vue";
import { activeScenario } from "../../src/composables/useScenario.ts";

const container = { template: "<div><slot /></div>" };
const stubs = Object.fromEntries(
    [
        "QLayout",
        "QHeader",
        "QToolbar",
        "QSpace",
        "QPageContainer",
        "QBanner",
        "RouterView"
    ].map(name => [name, container])
);
stubs.QBtn = {
    emits: ["click"],
    template: "<button @click=\"$emit('click')\"><slot /></button>"
};
let wrapper;
afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    delete window.windowControls;
    activeScenario.value = null;
});
function mountLayout() {
    wrapper = mount(MainLayout, { global: { stubs } });
    return wrapper;
}
function controls() {
    let publish;
    const unsubscribe = vi.fn();
    const api = {
        platform: "win32",
        getState: vi.fn(async () => ({ maximized: false })),
        minimize: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
        toggleMaximize: vi.fn(async () => ({ maximized: true })),
        onStateChanged: vi.fn(callback => {
            publish = callback;
            return unsubscribe;
        })
    };
    window.windowControls = api;
    return { api, unsubscribe, publish: state => publish(state) };
}

test("Windows controls dispatch actions, reflect native state and unsubscribe on unmount", async () => {
    const { api, publish, unsubscribe } = controls();
    const layout = mountLayout();
    await flushPromises();
    await layout.get('[aria-label="Minimize window"]').trigger("click");
    await layout.get('[aria-label="Maximize window"]').trigger("click");
    publish({ maximized: true });
    await flushPromises();
    expect(layout.find('[aria-label="Restore window"]').exists()).toBe(true);
    await layout.get('[aria-label="Restore window"]').trigger("click");
    await layout.get('[aria-label="Close window"]').trigger("click");
    expect(api.minimize).toHaveBeenCalledOnce();
    expect(api.toggleMaximize).toHaveBeenCalledTimes(2);
    expect(api.close).toHaveBeenCalledOnce();
    layout.unmount();
    wrapper = undefined;
    expect(unsubscribe).toHaveBeenCalledOnce();
});

test("native API failures show feedback and subsequent actions clear it", async () => {
    const { api } = controls();
    api.getState.mockRejectedValueOnce(new Error("Native state unavailable"));
    const layout = mountLayout();
    await flushPromises();
    expect(layout.get('[role="alert"]').text()).toContain(
        "Unable to update the window"
    );
    await layout.get('[aria-label="Minimize window"]').trigger("click");
    await flushPromises();
    expect(layout.find('[role="alert"]').exists()).toBe(false);
});

test("macOS and browser mode omit custom window controls", async () => {
    const { api } = controls();
    api.platform = "darwin";
    const mac = mountLayout();
    await flushPromises();
    expect(mac.find('[aria-label="Window controls"]').exists()).toBe(false);
    mac.unmount();
    delete window.windowControls;
    const browser = mountLayout();
    await flushPromises();
    expect(browser.find('[aria-label="Window controls"]').exists()).toBe(false);
});

test("a late state response after unmount does not update a destroyed layout", async () => {
    const { api, unsubscribe } = controls();
    let resolve;
    api.getState.mockImplementationOnce(
        () =>
            new Promise(done => {
                resolve = done;
            })
    );
    const layout = mountLayout();
    layout.unmount();
    wrapper = undefined;
    resolve({ maximized: true });
    await flushPromises();
    expect(unsubscribe).toHaveBeenCalledOnce();
});
