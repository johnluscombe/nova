// @vitest-environment jsdom
import { test, expect } from "vitest";
import { reactive, nextTick } from "vue";
import type { SliceData } from "../../src/types/slice";
import { mount } from "@vue/test-utils";
import LineGraph from "../../src/components/charts/LineGraph.vue";

test("line charts keep gaps for invalid samples and handle flat or empty data", async () => {
    const data = reactive<SliceData>({
        positionLabel: "Column",
        valueLabel: "Amplitude",
        points: [
            { position: 0, value: 5 },
            { position: 1, value: null },
            { position: 2, value: 5 }
        ]
    });
    const wrapper = mount(LineGraph, { props: { data } });

    expect(wrapper.get("path").attributes("d")!.match(/M/g)).toHaveLength(2);
    expect(wrapper.get("path").attributes("d")).not.toMatch(/NaN|Infinity/);
    data.points = [{ position: 0, value: null }];
    await nextTick();
    expect(wrapper.text()).toContain("No finite values");
    expect(wrapper.get("path").attributes("d")).toBe("");
    wrapper.unmount();
});
