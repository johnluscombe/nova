<template>
    <section class="statistics-panel" aria-label="Image statistics">
        <div class="row items-center justify-between">
            <strong>
                {{ widget.region ? "Region statistics" : "Statistics" }}
            </strong>
            <q-btn
                flat
                dense
                round
                icon="close"
                aria-label="Close statistics"
                @click="$emit('close')" />
        </div>
        <p
            v-if="
                widget.loading ||
                widget.regionBusy ||
                (!widget.region && widget.wholeStatisticsBusy)
            "
            role="status">
            Loading statistics…
        </p>
        <template v-else>
            <p v-if="widget.regionResult">
                {{ widget.regionResult.valueLabel }} ·
                {{ widget.regionResult.sampleCount }}
                finite samples{{
                    widget.regionResult.sampled ? " (sampled)" : ""
                }}
            </p>
            <p v-if="widget.regionResult?.sampleCount === 0">
                No finite pixel samples fall inside this region.
            </p>
            <p v-if="!widget.region && label">
                {{ label }}
            </p>
            <dl
                v-if="
                    statistics &&
                    Object.keys(visibleStatistics(statistics)).length
                ">
                <div
                    v-for="(value, label) in visibleStatistics(statistics)"
                    :key="label">
                    <dt>{{ label }}</dt>
                    <dd>
                        {{
                            typeof value === "number"
                                ? Number(value.toPrecision(7))
                                : (value ?? "Not available")
                        }}
                    </dd>
                </div>
            </dl>
            <p v-else>
                {{
                    widget.regionError ??
                    widget.previewStatisticsError ??
                    widget.error ??
                    (Object.keys(statistics).length
                        ? "The selected percentiles are not available for this image."
                        : "This plugin does not provide image statistics.")
                }}
            </p>
        </template>
    </section>
</template>

<script setup lang="ts">
import type { ImageWindow } from "@/types/image-window";
import { visibleStatistics } from "@/composables/useSettings";

defineProps<{
    widget: ImageWindow;

    statistics: Record<string, string | number | boolean | null>;

    label: string | number | boolean | null | undefined;
}>();
defineEmits<{ close: [] }>();
</script>

<style scoped>
.statistics-panel {
    flex-shrink: 0;
    max-height: 45%;
    overflow: auto;
    padding: 8px 12px;
    background: #f6f8fa;
    color: #243447;
    border-top: 1px solid #ccd4de;
    font-size: 12px;
}

.statistics-panel dl {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 24px;
    margin: 4px 0;
}

.statistics-panel dt {
    font-weight: 600;
}

.statistics-panel dd {
    margin: 2px 0 0;
    overflow-wrap: anywhere;
}
</style>
