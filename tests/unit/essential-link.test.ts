// @vitest-environment jsdom
import { test, expect } from "vitest";
import { mount } from "@vue/test-utils";
import EssentialLink from "../../src/components/EssentialLink.vue";
const global = {
    stubs: {
        QItem: { props: ["href"], template: '<a :href="href"><slot /></a>' },
        QItemSection: { template: "<section><slot /></section>" },
        QItemLabel: { template: "<span><slot /></span>" },
        QIcon: { props: ["name"], template: '<i :data-icon="name" />' }
    }
};
test("links show supplied labels, caption and icon, with safe default navigation", () => {
    const link = mount(EssentialLink, {
        props: {
            label: "Docs",
            caption: "Read docs",
            link: "https://example.com",
            icon: "school"
        },
        global
    });
    expect(link.get("a").attributes("href")).toBe("https://example.com");
    expect(link.text()).toContain("Read docs");
    expect(link.get("i").attributes("data-icon")).toBe("school");
    link.unmount();
    const minimal = mount(EssentialLink, {
        props: { label: "Default" },
        global
    });
    expect(minimal.get("a").attributes("href")).toBe("#");
    expect(minimal.find("i").exists()).toBe(false);
    minimal.unmount();
});
