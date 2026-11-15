<template>
    <q-dialog v-model="open">
        <q-card class="settings-dialog" role="dialog" aria-label="Settings">
            <q-card-section class="text-h6">Settings</q-card-section>
            <q-card-section>
                <q-select
                    v-model="percentiles"
                    outlined
                    multiple
                    use-chips
                    use-input
                    :input-debounce="0"
                    @filter="filterPercentiles"
                    :options="percentileOptions"
                    label="Percentiles"
                    aria-label="Percentiles"
                    hint="Select one or more percentiles"
                    @update:model-value="error = ''" />
                <p class="text-caption q-mt-md">
                    Applies immediately to all open images. Large images use
                    sampled amplitude data.
                </p>
            </q-card-section>
            <q-card-section>
                <div class="text-subtitle1 q-mb-sm">CPHD image formation</div>
                <q-select
                    v-model="formation.algorithm"
                    outlined
                    emit-value
                    map-options
                    :options="[
                        {
                            label: 'Backprojection (CPU)',
                            value: 'backprojection'
                        }
                    ]"
                    label="Algorithm" />
                <q-select
                    v-model="formation.imageSize"
                    outlined
                    class="q-mt-md"
                    :options="[64, 128, 256, 512]"
                    label="Output size (square pixels)" />
                <q-input
                    v-model.number="formation.pixelSpacing"
                    outlined
                    class="q-mt-md"
                    type="number"
                    min="0"
                    max="1000"
                    step="any"
                    label="Pixel spacing (m)"
                    hint="0 chooses spacing from the sampled spatial bandwidth" />
                <q-input
                    v-model.number="formation.maxVectors"
                    outlined
                    class="q-mt-md"
                    type="number"
                    min="8"
                    max="4096"
                    label="Maximum aperture vectors"
                    hint="Uses a contiguous aperture centered on the first channel" />
                <q-select
                    v-model="formation.window"
                    outlined
                    emit-value
                    map-options
                    class="q-mt-md"
                    :options="[
                        { label: 'Hann', value: 'hann' },
                        { label: 'Uniform', value: 'uniform' }
                    ]"
                    label="Window" />
                <p class="text-caption q-mt-md">
                    Applies to the next Form SICD operation. Supports monostatic
                    FX-domain CPHD 1.x. Output uses a local ground plane at the
                    scene reference point; values are uncalibrated.
                </p>
                <p v-if="error" class="text-negative" role="alert">
                    {{ error }}
                </p>
            </q-card-section>
            <q-card-actions align="right">
                <q-btn
                    flat
                    no-caps
                    label="Restore defaults"
                    @click="
                        percentiles = [...defaultPercentiles];
                        formation = { ...defaultFormationSettings };
                        error = '';
                    " />
                <q-btn flat no-caps label="Cancel" @click="open = false" />
                <q-btn color="primary" no-caps label="Save" @click="save" />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { validateFormationSettings } from "@/types/formation";
import {
    validatePercentiles,
    defaultPercentiles,
    selectedPercentiles,
    formationSettings,
    defaultFormationSettings,
    saveFormationSettings,
    savePercentiles
} from "@/composables/useSettings";
const open = defineModel<boolean>({ default: false });
const percentiles = ref<number[]>([]);
const formation = ref({ ...formationSettings.value });
const allPercentiles = Array.from({ length: 101 }, (_, index) => index);
const percentileOptions = ref(allPercentiles);
function filterPercentiles(
    query: string,
    update: (callback: () => void) => void
) {
    update(() => {
        percentileOptions.value = allPercentiles.filter(value =>
            String(value).includes(query.trim())
        );
    });
}
const error = ref("");
watch(
    open,
    value => {
        if (value) {
            percentiles.value = [...selectedPercentiles.value];
            formation.value = { ...formationSettings.value };
            error.value = "";
        }
    },
    { immediate: true }
);
function save() {
    try {
        validatePercentiles(percentiles.value);
        validateFormationSettings(formation.value);
        saveFormationSettings(formation.value);
        savePercentiles(percentiles.value);
        open.value = false;
    } catch (cause) {
        error.value =
            cause instanceof Error ? cause.message : "Unable to save settings.";
    }
}
</script>

<style scoped>
.settings-dialog {
    width: 480px;
    max-width: 90vw;
    max-height: 90vh;
    overflow: auto;
}
</style>
