<template>
    <svg
        class="image-axis axis-y"
        role="img"
        :aria-label="`Y axis: ${rowLabel}`">
        <title>{{ rowLabel }} · coordinates at pixel centers</title>
        <line x1="77" x2="77" :y1="rect.top" :y2="rect.top + rect.height" />
        <g v-for="tick in rowTicks" :key="tick.fraction">
            <line
                x1="72"
                x2="78"
                :y1="rect.top + tick.fraction * rect.height"
                :y2="rect.top + tick.fraction * rect.height" />
            <text
                x="68"
                :y="rect.top + tick.fraction * rect.height + 3"
                text-anchor="end">
                {{ format(tick.value) }}
            </text>
        </g>
        <text
            :transform="`translate(13,${rect.top + rect.height / 2}) rotate(-90)`"
            text-anchor="middle">
            {{ rowLabel }}
        </text>
    </svg>
    <svg
        class="image-axis axis-x"
        role="img"
        :aria-label="`X axis: ${columnLabel}`">
        <title>{{ columnLabel }} · coordinates at pixel centers</title>
        <line :x1="rect.left" :x2="rect.left + rect.width" y1="1" y2="1" />
        <g v-for="(tick, index) in columnTicks" :key="tick.fraction">
            <line
                :x1="rect.left + tick.fraction * rect.width"
                :x2="rect.left + tick.fraction * rect.width"
                y1="0"
                y2="6" />
            <text
                :x="rect.left + tick.fraction * rect.width"
                y="19"
                :text-anchor="
                    columnTicks.length === 1
                        ? 'middle'
                        : index === 0
                          ? 'start'
                          : index === columnTicks.length - 1
                            ? 'end'
                            : 'middle'
                ">
                {{ format(tick.value) }}
            </text>
        </g>
        <text :x="rect.left + rect.width / 2" y="40" text-anchor="middle">
            {{ columnLabel }}
        </text>
    </svg>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { axisTicks, type ImageAxes } from "@/types/axes";

const props = defineProps<{
    axes: ImageAxes;

    width: number;

    height: number;

    rect: {
        left: number;

        top: number;

        width: number;

        height: number;
    };
}>();

const rowLabel = computed(
    () => `${props.axes.row.label} (${props.axes.row.unit})`
);
const columnLabel = computed(
    () => `${props.axes.column.label} (${props.axes.column.unit})`
);

const rowTicks = computed(() =>
    axisTicks(props.axes.row, props.height, props.rect.height)
);
const columnTicks = computed(() =>
    axisTicks(props.axes.column, props.width, props.rect.width)
);

/**
 * Format an axis tick to a compact, readable numerical label.
 */
function format(value: number) {
    return Number(value.toPrecision(5)).toString();
}
</script>

<style scoped>
.image-axis {
    min-width: 0;
    min-height: 0;
    color: #d9e7f5;
    pointer-events: none;
}

.axis-y {
    grid-column: 1;
    grid-row: 1;
    width: 78px;
    height: 100%;
}

.axis-x {
    grid-column: 3;
    grid-row: 3;
    width: 100%;
    height: 50px;
}

line {
    stroke: #91a5ba;
    stroke-width: 1;
}

text {
    fill: currentColor;
    font: 10px sans-serif;
}
</style>
