<template>
    <q-dialog
        :model-value="open"
        @update:model-value="!$event && $emit('cancel')">
        <q-card class="color-scale-dialog">
            <q-card-section class="text-h6">Color Scale</q-card-section>
            <q-form @submit.prevent="apply">
                <q-card-section class="color-scale-fields">
                    <p>
                        {{
                            scientific
                                ? "Limits use the selected scientific scaling quantity."
                                : "Limits use image luminance (0–255)."
                        }}
                        {{
                            scientific
                                ? "Blank limits use the 1st–99th percentiles; amplitude retains logarithmic display."
                                : "Blank limits use 0–255."
                        }}
                    </p>
                    <q-input
                        v-model="maximum"
                        type="number"
                        step="any"
                        label="Maximum"
                        clearable />
                    <q-input
                        v-model="minimum"
                        type="number"
                        step="any"
                        label="Minimum"
                        clearable />
                    <q-select
                        :model-value="palette"
                        :options="paletteNames"
                        label="Palette"
                        @update:model-value="selectPalette" />
                    <p class="color-order-note">
                        Colors run from maximum at the top to minimum at the
                        bottom.
                    </p>
                    <div class="color-scale-editor">
                        <div class="color-stops">
                            <div
                                v-for="index in colorIndices"
                                :key="index"
                                class="color-stop">
                                <input
                                    type="color"
                                    v-model="colors[index]"
                                    :aria-label="`Choose ${colorLabel(index).toLowerCase()}`" />
                                <q-input
                                    v-model="colors[index]"
                                    :label="colorLabel(index)" />
                                <q-btn
                                    flat
                                    round
                                    icon="remove"
                                    :aria-label="`Remove ${colorLabel(index).toLowerCase()}`"
                                    :disable="colors.length <= 2"
                                    @click="colors.splice(index, 1)" />
                            </div>
                        </div>
                        <div class="palette-legend">
                            <span>Maximum</span>
                            <div
                                class="palette-preview"
                                :style="{
                                    background: `linear-gradient(to top, ${colors.join(', ')})`
                                }"
                                role="img"
                                aria-label="Color scale preview: maximum at top, minimum at bottom"></div>
                            <span>Minimum</span>
                        </div>
                    </div>
                    <q-btn
                        flat
                        label="Add Color"
                        icon="add"
                        :disable="colors.length >= 8"
                        @click="
                            colors.splice(colors.length - 1, 0, '#ffffff')
                        " />
                    <p v-if="error" role="alert" class="text-negative">
                        {{ error }}
                    </p>
                </q-card-section>
                <q-card-actions align="right">
                    <q-btn
                        flat
                        label="Reset"
                        @click="$emit('apply', undefined)" />
                    <q-btn flat label="Cancel" @click="$emit('cancel')" />
                    <q-btn type="submit" color="primary" label="Apply" />
                </q-card-actions>
            </q-form>
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
    colorPalettes,
    validateColorScale,
    type ColorScale
} from "@/types/color-scale";

const props = defineProps<{
    open: boolean;

    scale: ColorScale | undefined;

    scientific: boolean;
}>();
const emit = defineEmits<{
    apply: [scale: ColorScale | undefined];

    cancel: [];
}>();

const minimum = ref<string | number | null>(null);
const maximum = ref<string | number | null>(null);
const colors = ref<string[]>([]);
const error = ref("");
const colorIndices = computed(() =>
    colors.value.map((_, index) => index).reverse()
);
const paletteNames = [...colorPalettes.map(item => item.label), "Custom"];
const palette = computed(
    () =>
        colorPalettes.find(item => item.colors.join() === colors.value.join())
            ?.label ?? "Custom"
);

watch(
    () => props.open,
    open => {
        if (open) {
            minimum.value = props.scale?.minimum ?? null;
            maximum.value = props.scale?.maximum ?? null;
            colors.value = [
                ...(props.scale?.colors ?? colorPalettes[0]!.colors)
            ];
            error.value = "";
        }
    },
    { immediate: true }
);

/** Name the endpoints explicitly; interior stops show their position along the palette. */
function colorLabel(index: number): string {
    if (index === colors.value.length - 1) {
        return "Maximum color";
    }

    if (index === 0) {
        return "Minimum color";
    }

    return `${Math.round((index / (colors.value.length - 1)) * 100)}% color`;
}

/** Replace the editable color stops with a named palette. */
function selectPalette(name: string) {
    const preset = colorPalettes.find(item => item.label === name);

    if (preset) {
        colors.value = [...preset.colors];
    }
}

/** Validate numeric fields before applying the per-image mapping. */
function apply() {
    try {
        emit(
            "apply",
            validateColorScale({
                minimum:
                    minimum.value === "" || minimum.value === null
                        ? null
                        : Number(minimum.value),
                maximum:
                    maximum.value === "" || maximum.value === null
                        ? null
                        : Number(maximum.value),
                colors: colors.value
            })
        );
    } catch (cause) {
        error.value =
            cause instanceof Error ? cause.message : "Invalid color scale.";
    }
}
</script>

<style scoped>
.color-scale-dialog {
    width: 520px;
    max-width: 95vw;
}

.color-scale-fields {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.color-stop {
    display: flex;
    align-items: center;
    gap: 8px;
}

.color-stop > .q-field {
    flex: 1;
}

.color-order-note {
    margin: 0;
}

.color-scale-editor {
    display: flex;
    gap: 16px;
}

.color-stops {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    min-width: 0;
}

.palette-legend {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    font-size: 11px;
}

.palette-preview {
    width: 28px;
    flex: 1;
    min-height: 72px;
    border: 1px solid #cbd5e1;
}
</style>
