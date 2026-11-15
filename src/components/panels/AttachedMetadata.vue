<template>
    <section
        v-if="attachments.length"
        class="attached-metadata"
        aria-label="Attached JSON metadata">
        <strong>Attached JSON metadata</strong>
        <p class="text-caption">
            Axes:
            {{
                axesSource === "embedded"
                    ? "embedded metadata"
                    : axesSource === "pixel"
                      ? "pixel coordinates"
                      : attachments.find(item => item.path === axesSource)?.name
            }}
        </p>
        <p v-if="notice" class="text-caption">{{ notice }}</p>
        <q-btn
            v-if="
                (axesPreference && axesPreference !== 'embedded') ||
                (axesSource !== 'embedded' && axesSource !== 'pixel')
            "
            flat
            dense
            no-caps
            :label="hasEmbeddedAxes ? 'Use embedded axes' : 'Use pixel axes'"
            @click="$emit('selectAxes', 'embedded')" />
        <details
            v-for="item in attachments"
            :key="item.path"
            @toggle="
                expanded[item.path] = ($event.target as HTMLDetailsElement).open
            ">
            <summary :title="item.path">
                {{ item.name }}
                <span v-if="item.error">— unavailable</span>
            </summary>
            <p v-if="candidate(item.path)?.error" class="text-caption">
                Axes: {{ candidate(item.path)?.error }}
            </p>
            <q-btn
                v-if="candidate(item.path)?.axes"
                flat
                dense
                no-caps
                :disable="axesSource === item.path"
                :label="
                    axesSource === item.path
                        ? 'Axes active'
                        : hasEmbeddedAxes
                          ? 'Override embedded axes'
                          : 'Use these axes'
                "
                @click="$emit('selectAxes', item.path)" />
            <p v-if="item.error" class="text-negative">{{ item.error }}</p>
            <pre v-else-if="expanded[item.path]">{{
                JSON.stringify(item.data, null, 2)
            }}</pre>
        </details>
    </section>
</template>

<script setup lang="ts">
import { reactive } from "vue";
import type { MetadataAttachment } from "@/types/metadata";
import type { MetadataAxesCandidate } from "@/utils/metadata-axes";

const props = defineProps<{
    attachments: MetadataAttachment[];

    candidates?: MetadataAxesCandidate[];

    axesSource?: string;

    hasEmbeddedAxes?: boolean;

    notice?: string | undefined;

    axesPreference?: string | undefined;
}>();

defineEmits<{ selectAxes: [source: string] }>();

const expanded = reactive<Record<string, boolean>>({});

/**
 * Resolve the axis interpretation and status for a particular attached
 * metadata file.
 */
function candidate(path: string) {
    return props.candidates?.find(item => item.path === path);
}
</script>

<style scoped>
.attached-metadata {
    margin-top: 16px;
    border-top: 1px solid #ccd4de;
    padding-top: 12px;
}

details {
    margin-top: 8px;
}

summary {
    cursor: pointer;
    overflow-wrap: anywhere;
}

pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 360px;
    overflow: auto;
    font-size: 11px;
}
</style>
