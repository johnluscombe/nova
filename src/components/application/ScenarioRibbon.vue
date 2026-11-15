<template>
    <section class="ribbon" aria-label="Scenario ribbon">
        <q-tabs
            v-model="activeTab"
            dense
            no-caps
            align="left"
            class="ribbon-tabs"
            active-color="primary"
            indicator-color="primary">
            <q-tab name="home" label="Home" />
            <q-tab
                v-if="imageContext.available"
                name="image-tools"
                :label="
                    imageContext.scientific ? 'Scientific Imagery' : 'Image'
                " />
            <q-tab
                v-for="tab in pluginTabs"
                :key="tab.key"
                :name="tab.key"
                :label="tab.label" />
        </q-tabs>
        <div class="ribbon-content">
            <template v-if="activeTab === 'home'">
                <div
                    class="ribbon-group"
                    role="group"
                    aria-labelledby="scenario-group-label">
                    <div class="ribbon-actions">
                        <q-btn
                            flat
                            stack
                            no-caps
                            icon="note_add"
                            label="New"
                            :disable="busy"
                            @click="$emit('newScenario')" />
                        <q-btn
                            flat
                            stack
                            no-caps
                            icon="folder_open"
                            label="Open"
                            :disable="busy"
                            @click="$emit('openScenario')" />
                        <q-separator vertical inset class="q-mx-sm" />
                        <q-btn
                            flat
                            stack
                            no-caps
                            icon="close"
                            label="Close"
                            :disable="busy || !hasScenario"
                            @click="$emit('closeScenario')" />
                        <q-btn
                            v-for="button in homeButtons('file')"
                            :key="button.key"
                            flat
                            stack
                            no-caps
                            :icon="button.icon ?? 'extension'"
                            :label="button.label"
                            :disable="
                                busy ||
                                (button.requiresScenario && !hasScenario)
                            "
                            @click="
                                $emit(
                                    'pluginAction',
                                    button.pluginId,
                                    button.id
                                )
                            " />
                    </div>
                    <div id="scenario-group-label" class="ribbon-group-label">
                        Scenario
                    </div>
                </div>
                <div
                    class="ribbon-group"
                    role="group"
                    aria-labelledby="image-group-label">
                    <div class="ribbon-actions">
                        <q-btn
                            flat
                            stack
                            no-caps
                            icon="add_photo_alternate"
                            label="Add Image"
                            aria-label="Add Image"
                            :disable="busy || !hasScenario || !hasImageDecoders"
                            @click="$emit('openImage')" />
                        <q-btn
                            flat
                            stack
                            no-caps
                            icon="save"
                            label="Save"
                            :disable="busy || !imageContext.canSave"
                            @click="$emit('saveImage')" />
                        <q-btn
                            v-for="button in homeButtons('image')"
                            :key="button.key"
                            flat
                            stack
                            no-caps
                            :icon="button.icon ?? 'extension'"
                            :label="button.label"
                            :disable="
                                busy ||
                                (button.requiresScenario && !hasScenario)
                            "
                            @click="
                                $emit(
                                    'pluginAction',
                                    button.pluginId,
                                    button.id
                                )
                            " />
                    </div>
                    <div id="image-group-label" class="ribbon-group-label">
                        Image
                    </div>
                </div>
            </template>
            <template
                v-if="activeTab === 'image-tools' && imageContext.available">
                <div
                    class="ribbon-group"
                    role="group"
                    aria-labelledby="view-group-label">
                    <div class="ribbon-actions">
                        <q-btn
                            flat
                            stack
                            no-caps
                            icon="info"
                            label="Metadata"
                            :disable="!hasActiveWidget"
                            @click="$emit('metadata')" />

                        <q-btn
                            flat
                            stack
                            no-caps
                            icon="square_foot"
                            label="Axes"
                            :disable="!hasSliceImage"
                            :aria-pressed="axesActive"
                            :color="axesActive ? 'primary' : undefined"
                            @click="$emit('axes')" />
                        <q-btn
                            flat
                            stack
                            no-caps
                            icon="my_location"
                            label="Pixel Values"
                            :disable="!hasSliceImage"
                            :aria-pressed="pixelValuesActive"
                            :color="pixelValuesActive ? 'primary' : undefined"
                            @click="$emit('pixelValues')" />
                        <q-btn
                            flat
                            stack
                            no-caps
                            icon="bar_chart"
                            label="Statistics"
                            :disable="!hasActiveStatistics"
                            @click="$emit('statistics')" />
                    </div>
                    <div id="view-group-label" class="ribbon-group-label">
                        View
                    </div>
                </div>
                <div
                    class="ribbon-group"
                    role="group"
                    aria-labelledby="edit-group-label">
                    <div class="ribbon-actions">
                        <q-btn
                            flat
                            stack
                            no-caps
                            icon="tune"
                            label="Scaling"
                            :disable="
                                !scalingState.options.length ||
                                scalingState.loading ||
                                busy
                            ">
                            <q-menu>
                                <q-list dense aria-label="Image scaling">
                                    <q-item
                                        v-for="option in scalingOptions"
                                        :key="option.value"
                                        clickable
                                        role="menuitemradio"
                                        :aria-checked="
                                            scalingState.value === option.value
                                        "
                                        v-close-popup
                                        :disable="
                                            !scalingState.options.includes(
                                                option.value
                                            )
                                        "
                                        :active="
                                            scalingState.value === option.value
                                        "
                                        @click="$emit('scaling', option.value)">
                                        <q-item-section>
                                            {{ option.label }}
                                        </q-item-section>
                                        <q-item-section
                                            side
                                            v-if="
                                                scalingState.value ===
                                                option.value
                                            ">
                                            <q-icon name="check" />
                                        </q-item-section>
                                    </q-item>
                                </q-list>
                            </q-menu>
                        </q-btn>
                        <q-btn
                            flat
                            stack
                            no-caps
                            icon="crop"
                            label="Crop"
                            :disable="busy || !cropState.available"
                            :aria-pressed="cropState.active"
                            :color="cropState.active ? 'primary' : undefined"
                            @click="$emit('crop')" />
                    </div>
                    <div id="edit-group-label" class="ribbon-group-label">
                        Edit
                    </div>
                </div>
                <div
                    class="ribbon-group"
                    role="group"
                    aria-labelledby="data-group-label">
                    <div class="ribbon-actions">
                        <q-btn
                            flat
                            stack
                            no-caps
                            icon="attach_file"
                            label="Attach Metadata"
                            :disable="busy || !hasActiveWidget"
                            @click="$emit('attachMetadata')" />
                        <q-btn
                            v-if="imageContext.scientific"
                            flat
                            stack
                            no-caps
                            icon="auto_fix_high"
                            label="Form SICD"
                            :disable="busy || !imageContext.canFormSicd"
                            @click="$emit('formSicd')" />
                        <q-btn
                            v-if="imageContext.scientific"
                            flat
                            stack
                            no-caps
                            icon="image"
                            label="Create SIDD"
                            :disable="busy || !imageContext.canCreateSidd"
                            @click="$emit('createSidd')" />
                    </div>
                    <div id="data-group-label" class="ribbon-group-label">
                        Data
                    </div>
                </div>
                <div
                    class="ribbon-group"
                    role="group"
                    aria-labelledby="analysis-group-label">
                    <div class="ribbon-actions">
                        <q-btn
                            flat
                            stack
                            no-caps
                            icon="polyline"
                            label="Polygon"
                            :disable="!regionState.available"
                            :aria-pressed="regionState.drawing"
                            :color="regionState.drawing ? 'primary' : undefined"
                            @click="$emit('polygon')" />
                        <q-btn
                            flat
                            stack
                            no-caps
                            icon="deselect"
                            label="Clear Region"
                            :disable="
                                !regionState.available ||
                                (!regionState.selected && !regionState.drawing)
                            "
                            @click="$emit('clearRegion')" />
                        <q-btn
                            flat
                            stack
                            no-caps
                            icon="content_cut"
                            label="Slice"
                            :disable="!hasSliceImage"
                            :aria-pressed="sliceModeActive"
                            :color="sliceModeActive ? 'primary' : undefined"
                            @click="$emit('slice')" />
                    </div>
                    <div id="analysis-group-label" class="ribbon-group-label">
                        Analysis
                    </div>
                </div>
            </template>
            <div
                class="ribbon-group"
                role="group"
                aria-labelledby="settings-group-label">
                <div class="ribbon-actions">
                    <q-btn
                        flat
                        stack
                        no-caps
                        icon="settings"
                        label="Settings"
                        @click="$emit('settings')" />
                </div>
                <div id="settings-group-label" class="ribbon-group-label">
                    Settings
                </div>
            </div>
            <div
                v-for="group in extraGroups"
                :key="group.key"
                class="ribbon-group"
                role="group"
                :aria-label="group.label">
                <div class="ribbon-actions">
                    <q-btn
                        v-for="button in group.buttons"
                        :key="button.key"
                        flat
                        stack
                        no-caps
                        :icon="button.icon ?? 'extension'"
                        :label="button.label"
                        :disable="
                            busy || (button.requiresScenario && !hasScenario)
                        "
                        @click="
                            $emit('pluginAction', button.pluginId, button.id)
                        " />
                </div>
                <div class="ribbon-group-label">{{ group.label }}</div>
            </div>
        </div>
        <q-linear-progress
            v-if="busy"
            indeterminate
            color="primary"
            class="ribbon-progress" />
    </section>
</template>

<script setup lang="ts">
import { computed, ref, toRefs, watch } from "vue";
import type { ImagePluginStatus } from "@/types/image";
import type { ImageContext } from "@/types/workspace";
import type { RegionState } from "@/types/region";
import {
    scalingOptions,
    type Scaling,
    type ScalingState
} from "@/types/scaling";

const props = defineProps<{
    busy: boolean;

    hasScenario: boolean;

    pluginStatus: ImagePluginStatus | null;

    imageContext: ImageContext;

    hasActiveWidget: boolean;

    hasSliceImage: boolean;

    hasActiveStatistics: boolean;

    axesActive: boolean;

    pixelValuesActive: boolean;

    sliceModeActive: boolean;

    cropState: {
        available: boolean;

        active: boolean;
    };

    regionState: RegionState;

    scalingState: ScalingState;
}>();
const { imageContext, pluginStatus } = toRefs(props);

defineEmits<{
    newScenario: [];

    openScenario: [];

    closeScenario: [];

    openImage: [];

    saveImage: [];

    settings: [];

    pluginAction: [pluginId: string, actionId: string];

    metadata: [];

    axes: [];

    pixelValues: [];

    statistics: [];

    crop: [];

    polygon: [];

    clearRegion: [];

    slice: [];

    attachMetadata: [];

    formSicd: [];

    createSidd: [];

    scaling: [value: Scaling];
}>();

const activeTab = ref("home");

watch(
    () => imageContext.value.available,
    available => {
        if (!available && activeTab.value === "image-tools") {
            activeTab.value = "home";
        }
    }
);

const hasImageDecoders = computed(
    () =>
        pluginStatus.value?.plugins.some(plugin => plugin.extensions.length) ??
        false
);
const pluginTabs = computed(() =>
    (pluginStatus.value?.plugins ?? []).flatMap(plugin =>
        (plugin.ribbon?.tabs ?? [])
            .filter(tab => tab.id !== "home")
            .map(tab => ({ key: `${plugin.id}:${tab.id}`, label: tab.label }))
    )
);
const ribbonGroups = computed(() =>
    (pluginStatus.value?.plugins ?? []).flatMap(plugin =>
        (plugin.ribbon?.tabs ?? []).flatMap(tab =>
            tab.groups.map(group => ({
                key: `${plugin.id}:${tab.id}:${group.id}`,
                id: group.id,
                tab: tab.id === "home" ? "home" : `${plugin.id}:${tab.id}`,
                label: group.label,
                buttons: group.buttons.map(button => ({
                    ...button,
                    pluginId: plugin.id,
                    key: `${plugin.id}:${button.id}`
                }))
            }))
        )
    )
);
const extraGroups = computed(() =>
    ribbonGroups.value.filter(
        group =>
            group.tab === activeTab.value &&
            !(
                activeTab.value === "home" &&
                ["file", "image"].includes(group.id)
            )
    )
);

/**
 * Select plugin contributions targeting a built-in Home ribbon group.
 */
function homeButtons(groupId: string) {
    return ribbonGroups.value
        .filter(group => group.tab === "home" && group.id === groupId)
        .flatMap(group => group.buttons);
}
</script>

<style scoped>
.ribbon {
    flex-shrink: 0;
    background: white;
    border-bottom: 1px solid #d8dfe8;
    position: relative;
    z-index: 5;
}

.ribbon-tabs {
    min-height: 30px;
    color: #234c78;
}

.ribbon-tabs :deep(.q-tab) {
    min-height: 30px;
    padding: 0 12px;
}

.ribbon-tabs :deep(.q-tab__label) {
    font-size: 12px;
}

.ribbon-content {
    display: flex;
    gap: 8px;
    border-top: 1px solid #e7ecf2;
    padding: 4px 12px 3px;
    overflow-x: auto;
}

.ribbon-group {
    flex-shrink: 0;
    display: inline-flex;
    flex-direction: column;
    border-right: 1px solid #d8dfe8;
    padding-right: 8px;
}

.ribbon-actions {
    display: flex;
    min-height: 50px;
}

.ribbon-actions :deep(.q-btn) {
    min-width: 52px;
    padding: 4px 8px;
    font-size: 11px;
    line-height: 1.3;
    color: #234c78;
}

.ribbon-actions :deep(.q-btn .q-icon) {
    font-size: 22px;
}

.ribbon-group-label {
    text-align: center;
    font-size: 10px;
    color: #66758a;
    padding-top: 2px;
}

.ribbon-progress {
    position: absolute;
    bottom: 0;
}
</style>
