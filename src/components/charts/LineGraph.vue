<template>
    <div class="line-graph">
        <svg
            viewBox="0 0 640 320"
            role="img"
            :aria-label="`${data.valueLabel} by ${data.positionLabel}`">
            <rect width="640" height="320" fill="#f8fafc" />
            <template v-for="tick in ticks" :key="tick">
                <line
                    x1="78"
                    x2="615"
                    :y1="270 - tick * 235"
                    :y2="270 - tick * 235"
                    stroke="#dce3eb" />
                <text x="70" :y="274 - tick * 235" text-anchor="end">
                    {{ format(low + tick * (high - low)) }}
                </text>
                <text :x="78 + tick * 537" y="288" text-anchor="middle">
                    {{ format(start + tick * (end - start)) }}
                </text>
            </template>
            <path :d="path" fill="none" stroke="#1976d2" stroke-width="1.7" />
            <g
                v-if="
                    data.points.length === 1 && data.points[0]?.value !== null
                ">
                <circle cx="78" cy="152.5" r="3" fill="#1976d2" />
            </g>
            <text x="345" y="312" text-anchor="middle">
                {{ data.positionLabel }}
            </text>
            <text
                transform="translate(16,155) rotate(-90)"
                text-anchor="middle">
                {{ data.valueLabel }}
            </text>
        </svg>
        <span v-if="!values.length" class="graph-note">
            No finite values in this slice.
        </span>
        <span class="graph-note">
            {{ data.points.length }} samples · gaps indicate invalid or
            transparent pixels
        </span>
    </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { SliceData } from "@/types/slice";

const props = defineProps<{ data: SliceData }>();

const ticks = [0, 0.25, 0.5, 0.75, 1];

const values = computed(() =>
    props.data.points.flatMap(point =>
        point.value === null ? [] : [point.value]
    )
);
const low = computed(() =>
    values.value.length ? Math.min(...values.value) : 0
);
const high = computed(() =>
    values.value.length ? Math.max(...values.value) : 1
);

const start = computed(() => props.data.points[0]?.position ?? 0);
const end = computed(() => props.data.points.at(-1)?.position ?? 1);

const path = computed(() => {
    let move = true;

    return props.data.points
        .map(point => {
            if (point.value === null) {
                move = true;

                return "";
            }

            const x =
                78 +
                ((point.position - start.value) /
                    (end.value - start.value || 1)) *
                    537;
            const y =
                high.value === low.value
                    ? 152.5
                    : 270 -
                      ((point.value - low.value) / (high.value - low.value)) *
                          235;
            const command = `${move ? "M" : "L"}${x},${y}`;

            move = false;

            return command;
        })
        .join(" ");
});

/**
 * Format finite graph coordinates compactly while retaining useful
 * precision.
 */
function format(value: number) {
    return Number(value.toPrecision(4)).toString();
}
</script>

<style scoped>
.line-graph {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: #f8fafc;
    color: #334155;
}

svg {
    width: 100%;
    flex: 1;
    min-height: 0;
}

text {
    font: 11px sans-serif;
    fill: #334155;
}

.graph-note {
    font-size: 10px;
    text-align: center;
    padding: 3px;
}
</style>
