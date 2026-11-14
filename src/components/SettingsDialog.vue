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
                    :error="!!error"
                    :error-message="error"
                    @update:model-value="error = ''"
                />
                <p class="text-caption q-mt-md"
                    >Applies immediately to all open images. Large images use
                    sampled amplitude data.</p
                >
            </q-card-section>
            <q-card-actions align="right">
                <q-btn
                    flat
                    no-caps
                    label="Restore defaults"
                    @click="
                        percentiles = [...defaultPercentiles];
                        error = '';
                    "
                />
                <q-btn flat no-caps label="Cancel" @click="open = false" />
                <q-btn color="primary" no-caps label="Save" @click="save" />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import {
    defaultPercentiles,
    selectedPercentiles,
    savePercentiles
} from "@/composables/useSettings";
const open = defineModel<boolean>({ default: false });
const percentiles = ref<number[]>([]);
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
            error.value = "";
        }
    },
    { immediate: true }
);
function save() {
    try {
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
}
</style>
