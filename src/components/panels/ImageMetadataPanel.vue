<template>
    <aside class="metadata-panel" aria-label="Image metadata">
        <div class="row items-center justify-between">
            <strong>Metadata</strong>
            <q-btn
                flat
                dense
                round
                icon="close"
                aria-label="Close metadata"
                @click="$emit('close')" />
        </div>
        <p v-if="widget.loading" role="status">Loading metadata…</p>
        <dl>
            <template
                v-for="([label, value], index) in metadataEntries(widget)"
                :key="index">
                <dt>{{ label }}</dt>
                <dd>
                    {{
                        typeof value === "number"
                            ? Number(value.toPrecision(7))
                            : (value ?? "Not available")
                    }}
                </dd>
            </template>
        </dl>
        <AttachedMetadata
            :attachments="widget.image.attachedMetadata ?? []"
            :candidates="metadataAxesCandidates(widget.image)"
            :axes-source="widget.image.axesSource ?? 'pixel'"
            :has-embedded-axes="!!widget.image.embeddedAxes"
            :notice="widget.image.axesNotice"
            :axes-preference="widget.metadataAxesSource"
            @select-axes="$emit('selectAxes', $event)" />
    </aside>
</template>

<script setup lang="ts">
import type { ImageWindow } from "@/types/image-window";
import AttachedMetadata from "@/components/panels/AttachedMetadata.vue";
import { metadataAxesCandidates } from "@/utils/metadata-axes";

defineProps<{ widget: ImageWindow }>();
defineEmits<{
    close: [];

    selectAxes: [source: string];
}>();
/**
 * Build the metadata panel entries for the image and its plugin-provided
 * metadata.
 */
function metadataEntries(widget: ImageWindow) {
    return [
        ["Name", widget.image.name],
        ["Path", widget.image.path],
        ["Reader", widget.image.pluginName],
        ["Width", widget.image.width],
        ["Height", widget.image.height],
        ...Object.entries(widget.image.metadata ?? {})
    ];
}
</script>

<style scoped>
.metadata-panel {
    flex: 0 0 240px;
    max-width: 50%;
    overflow: auto;
    padding: 12px;
    background: #f6f8fa;
    color: #243447;
    border-left: 1px solid #ccd4de;
    font-size: 12px;
}

.metadata-panel dt {
    font-weight: 600;
    margin-top: 10px;
}

.metadata-panel dd {
    margin: 3px 0 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}
</style>
