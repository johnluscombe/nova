<template>
    <q-page class="scenario-page">
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
                                @click="newScenario" />
                            <q-btn
                                flat
                                stack
                                no-caps
                                icon="folder_open"
                                label="Open"
                                :disable="busy"
                                @click="openScenario()" />
                            <q-separator vertical inset class="q-mx-sm" />
                            <q-btn
                                flat
                                stack
                                no-caps
                                icon="close"
                                label="Close"
                                :disable="busy || !scenario"
                                @click="closeScenario" />
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
                                    (button.requiresScenario && !scenario)
                                "
                                @click="
                                    runPluginAction(button.pluginId, button.id)
                                " />
                        </div>
                        <div
                            id="scenario-group-label"
                            class="ribbon-group-label">
                            Scenario
                        </div>
                    </div>
                    <div
                        class="ribbon-group"
                        role="group"
                        aria-label="Add image">
                        <div class="ribbon-actions add-image-action">
                            <q-btn
                                flat
                                stack
                                no-caps
                                icon="add_photo_alternate"
                                label="Add Image"
                                aria-label="Add Image"
                                :disable="
                                    busy || !scenario || !hasImageDecoders
                                "
                                @click="openImage()" />
                        </div>
                    </div>
                    <div
                        class="ribbon-group"
                        role="group"
                        aria-labelledby="image-group-label"
                        v-if="homeButtons('image').length">
                        <div class="ribbon-actions">
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
                                    (button.requiresScenario && !scenario)
                                "
                                @click="
                                    runPluginAction(button.pluginId, button.id)
                                " />
                        </div>
                        <div id="image-group-label" class="ribbon-group-label">
                            Image
                        </div>
                    </div>
                </template>
                <template
                    v-if="
                        activeTab === 'image-tools' && imageContext.available
                    ">
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
                                @click="workspace?.toggleMetadata()" />

                            <q-btn
                                flat
                                stack
                                no-caps
                                icon="square_foot"
                                label="Axes"
                                :disable="!hasSliceImage"
                                :aria-pressed="axesActive"
                                :color="axesActive ? 'primary' : undefined"
                                @click="workspace?.toggleAxes()" />
                            <q-btn
                                flat
                                stack
                                no-caps
                                icon="my_location"
                                label="Pixel Values"
                                :disable="!hasSliceImage"
                                :aria-pressed="pixelValuesActive"
                                :color="
                                    pixelValuesActive ? 'primary' : undefined
                                "
                                @click="workspace?.togglePixelValues()" />
                            <q-btn
                                flat
                                stack
                                no-caps
                                icon="bar_chart"
                                label="Statistics"
                                :disable="!hasActiveStatistics"
                                @click="workspace?.toggleStatistics()" />
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
                                                scalingState.value ===
                                                option.value
                                            "
                                            v-close-popup
                                            :disable="
                                                !scalingState.options.includes(
                                                    option.value
                                                )
                                            "
                                            :active="
                                                scalingState.value ===
                                                option.value
                                            "
                                            @click="
                                                workspace?.setScaling(
                                                    option.value
                                                )
                                            ">
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
                                :color="
                                    cropState.active ? 'primary' : undefined
                                "
                                @click="workspace?.toggleCrop()" />
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
                                @click="workspace?.attachMetadata()" />
                            <q-btn
                                v-if="imageContext.scientific"
                                flat
                                stack
                                no-caps
                                icon="auto_fix_high"
                                label="Form SICD"
                                :disable="busy || !imageContext.canFormSicd"
                                @click="formSicd" />
                            <q-btn
                                v-if="imageContext.scientific"
                                flat
                                stack
                                no-caps
                                icon="image"
                                label="Create SIDD"
                                :disable="busy || !imageContext.canCreateSidd"
                                @click="createSidd" />
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
                                :color="
                                    regionState.drawing ? 'primary' : undefined
                                "
                                @click="workspace?.togglePolygon()" />
                            <q-btn
                                flat
                                stack
                                no-caps
                                icon="deselect"
                                label="Clear Region"
                                :disable="
                                    !regionState.available ||
                                    (!regionState.selected &&
                                        !regionState.drawing)
                                "
                                @click="workspace?.clearRegion()" />
                            <q-btn
                                flat
                                stack
                                no-caps
                                icon="content_cut"
                                label="Slice"
                                :disable="!hasSliceImage"
                                :aria-pressed="sliceModeActive"
                                :color="sliceModeActive ? 'primary' : undefined"
                                @click="workspace?.toggleSlice()" />
                        </div>
                        <div
                            id="analysis-group-label"
                            class="ribbon-group-label">
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
                            @click="settingsOpen = true" />
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
                                busy || (button.requiresScenario && !scenario)
                            "
                            @click="
                                runPluginAction(button.pluginId, button.id)
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
        <SettingsDialog v-model="settingsOpen" />
        <q-dialog
            :model-value="!!actionMessage"
            @update:model-value="actionMessage = ''">
            <q-card>
                <q-card-section>{{ actionMessage }}</q-card-section>
                <q-card-actions align="right">
                    <q-btn flat label="OK" @click="actionMessage = ''" />
                </q-card-actions>
            </q-card>
        </q-dialog>
        <main class="scenario-content" :aria-busy="busy">
            <div
                v-if="
                    error ||
                    (pluginStatus &&
                        (!hasImageDecoders || pluginStatus.errors.length) &&
                        !pluginNoticeDismissed)
                "
                class="workspace-info">
                <q-banner
                    v-if="error"
                    class="bg-red-1 text-negative q-mb-sm shadow-3"
                    inline-actions
                    role="alert">
                    {{ error }}
                    <template #action>
                        <q-btn
                            flat
                            dense
                            round
                            icon="close"
                            aria-label="Dismiss error"
                            @click="error = ''" />
                    </template>
                </q-banner>
                <q-banner
                    v-if="
                        pluginStatus &&
                        (!hasImageDecoders || pluginStatus.errors.length) &&
                        !pluginNoticeDismissed
                    "
                    class="bg-blue-1 shadow-3"
                    inline-actions>
                    <div v-if="!hasImageDecoders">
                        Install an image plugin to enable Add Image.
                    </div>
                    <div class="text-caption image-path">
                        Plugin folder: {{ pluginStatus.directory }}
                    </div>
                    <div
                        v-for="issue in pluginStatus.errors"
                        :key="issue"
                        class="text-negative">
                        {{ issue }}
                    </div>
                    <div class="text-caption">
                        Restart Nova after installing or changing a plugin.
                    </div>
                    <template #action>
                        <q-btn
                            flat
                            dense
                            round
                            icon="close"
                            aria-label="Dismiss plugin notice"
                            @click="pluginNoticeDismissed = true" />
                    </template>
                </q-banner>
            </div>
            <ImageWorkspace
                @active-change="hasActiveWidget = $event"
                @image-context-change="imageContext = $event"
                @region-change="regionState = $event"
                @crop-change="cropState = $event"
                @statistics-change="hasActiveStatistics = $event"
                @slice-change="hasSliceImage = $event"
                @slice-mode-change="sliceModeActive = $event"
                @pixel-values-change="pixelValuesActive = $event"
                @axes-change="axesActive = $event"
                @scaling-change="scalingState = $event"
                @scaling-error="error = $event"
                @metadata-error="error = $event"
                :key="workspaceSession"
                ref="workspace"
                @change="saveLayout" />
        </main>
    </q-page>
</template>

<script setup lang="ts">
import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    watch
} from "vue";
import SettingsDialog from "@/components/SettingsDialog.vue";
import ImageWorkspace from "@/components/ImageWorkspace.vue";
import type { ImagePluginStatus } from "../types/image";
import type {
    ImageContext,
    ImageWorkspaceAPI,
    SavedImageWindow
} from "../types/workspace";
import type { ScenarioInfo } from "../types/scenario";
import { activeScenario as scenario } from "@/composables/useScenario";
import type { RegionState } from "@/types/region";
import { scalingOptions, type ScalingState } from "@/types/scaling";
const scalingState = ref<ScalingState>({
    options: [],
    value: "amplitude",
    loading: false
});
const settingsOpen = ref(false);
const busy = ref(false);
const error = ref("");
const workspace = ref<ImageWorkspaceAPI>();
const sliceModeActive = ref(false);
const pixelValuesActive = ref(false);
const axesActive = ref(false);
const cropState = ref({ available: false, active: false });
const regionState = ref<RegionState>({
    available: false,
    drawing: false,
    selected: false
});
const hasSliceImage = ref(false);
const hasActiveWidget = ref(false);
const hasActiveStatistics = ref(false);
const workspaceSession = ref(0);

const pluginNoticeDismissed = ref(false);
const pluginStatus = ref<ImagePluginStatus | null>(null);

const activeTab = ref("home");
const imageContext = ref<ImageContext>({ available: false, scientific: false });
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
function homeButtons(groupId: string) {
    return ribbonGroups.value
        .filter(group => group.tab === "home" && group.id === groupId)
        .flatMap(group => group.buttons);
}
async function runPluginAction(pluginId: string, actionId: string) {
    if (!window.images || busy.value) {
        return;
    }
    busy.value = true;
    error.value = "";
    try {
        await flushLayout();
        const result = await window.images.executeRibbonAction(
            pluginId,
            actionId
        );
        if (result.message) {
            actionMessage.value = result.message;
        }
    } catch (cause) {
        error.value =
            cause instanceof Error ? cause.message : "Plugin action failed.";
    } finally {
        busy.value = false;
    }
}
const actionMessage = ref("");

async function loadPlugins() {
    if (!window.images) {
        return;
    }
    busy.value = true;
    error.value = "";
    try {
        pluginStatus.value = await window.images.plugins();
    } catch (cause) {
        error.value =
            cause instanceof Error
                ? cause.message
                : "Unable to load image plugins.";
    } finally {
        busy.value = false;
    }
}
let saves: Promise<void> = Promise.resolve();
let saveFailure: unknown;
let stopFlushListener: (() => void) | undefined;
function saveLayout(windows: SavedImageWindow[]) {
    const filePath = scenario.value?.path;
    if (!filePath) {
        return;
    }
    // Send immediately; Electron serializes and finishes pending writes before closing.
    const request = window.scenario.saveWorkspace(filePath, windows);
    saves = Promise.all([saves, request])
        .then(() => {
            saveFailure = undefined;
        })
        .catch(cause => {
            saveFailure = cause;
            error.value =
                cause instanceof Error
                    ? cause.message
                    : "Unable to save workspace.";
        });
}
async function flushLayout() {
    if (scenario.value && workspace.value) {
        saveLayout(workspace.value.snapshot());
    }
    await saves;
    if (saveFailure) {
        throw saveFailure;
    }
}
onMounted(async () => {
    stopFlushListener = window.scenario?.onFlushRequested(() => {
        void flushLayout()
            .then(() => window.scenario.confirmClose())
            .catch(cause => {
                error.value = `Unable to save before closing: ${cause instanceof Error ? cause.message : String(cause)}`;
            });
    });
    await loadPlugins();
    if (!window.scenario) {
        return;
    }
    busy.value = true;
    try {
        const restored = await window.scenario.restoreLast();
        if (restored) {
            await showScenario(restored);
        }
    } catch (cause) {
        error.value =
            cause instanceof Error
                ? cause.message
                : "Unable to restore scenario.";
    } finally {
        busy.value = false;
    }
});
onBeforeUnmount(() => stopFlushListener?.());

function allowFileDrop(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = busy.value ? "none" : "copy";
    }
}
async function dropFiles(event: DragEvent) {
    event.preventDefault();
    if (busy.value || !event.dataTransfer?.files.length) {
        return;
    }
    error.value = "";
    try {
        const paths = Array.from(
            event.dataTransfer.files,
            file => window.images?.pathForFile(file) ?? ""
        );
        if (paths.some(file => !file)) {
            throw new Error("Unable to read dropped file paths.");
        }
        const scenarios = paths.filter(file => /\.scenario$/i.test(file));
        if (scenarios.length > 1) {
            throw new Error("Drop one scenario at a time.");
        }
        if (scenarios[0]) {
            await openScenario(scenarios[0]);
        }
        if (error.value) {
            return;
        }
        const images = paths.filter(file => !/\.scenario$/i.test(file));
        if (images.length) {
            if (!scenario.value) {
                throw new Error(
                    "Open or create a scenario before opening images."
                );
            }
            await openImage(images);
        }
    } catch (cause) {
        error.value =
            cause instanceof Error
                ? cause.message
                : "Unable to open dropped files.";
    }
}
onMounted(() => {
    window.addEventListener("dragover", allowFileDrop);
    window.addEventListener("drop", dropFiles);
});
onBeforeUnmount(() => {
    window.removeEventListener("dragover", allowFileDrop);
    window.removeEventListener("drop", dropFiles);
});

async function formSicd() {
    if (busy.value || !imageContext.value.canFormSicd) {
        return;
    }
    busy.value = true;
    try {
        await workspace.value?.formSicd();
    } finally {
        busy.value = false;
    }
}

async function createSidd() {
    if (busy.value || !imageContext.value.canCreateSidd) {
        return;
    }
    busy.value = true;
    try {
        await workspace.value?.createSidd();
    } finally {
        busy.value = false;
    }
}

async function openImage(paths?: string | string[]) {
    if (!scenario.value || busy.value) {
        return;
    }
    busy.value = true;
    error.value = "";
    const loading = new Map<string, number>();
    try {
        if (!window.images) {
            throw new Error("Open images in the Nova desktop app.");
        }
        const result = await window.images.importFiles(update => {
            if (update.status === "loading" && update.image) {
                const id = workspace.value?.add(update.image, true);
                if (id !== undefined) {
                    loading.set(update.key, id);
                }
            } else if (update.status === "ready" && update.image) {
                const id = loading.get(update.key);
                if (id !== undefined) {
                    workspace.value?.complete(id, update.image);
                } else {
                    workspace.value?.add(update.image);
                }
            } else if (update.status === "error") {
                const id = loading.get(update.key);
                if (id !== undefined) {
                    workspace.value?.fail(
                        id,
                        update.error ?? "Unable to open image."
                    );
                }
            }
        }, paths);
        error.value = result.errors.join("\n");
    } catch (cause) {
        error.value =
            cause instanceof Error ? cause.message : "Unable to open image.";
        for (const id of loading.values()) {
            workspace.value?.fail(id, error.value);
        }
    } finally {
        busy.value = false;
    }
}

async function showScenario(opened: ScenarioInfo) {
    workspaceSession.value++;
    scenario.value = opened;
    await nextTick();
    workspace.value?.hydrate(opened.workspace ?? []);
    if (opened.workspace?.some(widget => widget.loading)) {
        await window.scenario.loadImages(update => {
            if (update.image) {
                workspace.value?.complete(update.id, update.image);
            } else {
                workspace.value?.fail(
                    update.id,
                    update.error ?? "Unable to restore image."
                );
            }
        });
    }
}

async function newScenario() {
    busy.value = true;
    error.value = "";
    try {
        if (!window.scenario) {
            throw new Error("Use the Nova desktop app to create scenarios.");
        }
        await flushLayout();
        const created = await window.scenario.create();
        if (created) {
            await showScenario(created);
        }
    } catch (cause) {
        error.value =
            cause instanceof Error
                ? cause.message
                : "Unable to create scenario.";
    } finally {
        busy.value = false;
    }
}

async function openScenario(filePath?: string) {
    busy.value = true;
    error.value = "";
    try {
        if (!window.scenario) {
            throw new Error("Open scenarios in the Nova desktop app.");
        }
        await flushLayout();
        const opened = await window.scenario.open(filePath);
        if (opened) {
            await showScenario(opened);
        }
    } catch (cause) {
        error.value =
            cause instanceof Error ? cause.message : "Unable to open scenario.";
    } finally {
        busy.value = false;
    }
}

async function closeScenario() {
    busy.value = true;
    try {
        await flushLayout();
        await window.scenario.close();
        scenario.value = null;
        workspaceSession.value++;
        error.value = "";
    } catch (cause) {
        error.value =
            cause instanceof Error
                ? cause.message
                : "Unable to close scenario.";
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped>
.scenario-page {
    background: #f5f7fa;
    height: calc(100dvh - 36px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
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
.add-image-action {
    flex-shrink: 0;
    align-self: flex-start;
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
.scenario-content {
    position: relative;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
}
.image-path {
    overflow-wrap: anywhere;
}
.workspace-info {
    position: absolute;
    top: 12px;
    right: 16px;
    z-index: 100000;
    width: min(560px, calc(100% - 32px));
    max-height: calc(100% - 24px);
    overflow: auto;
    overflow-wrap: anywhere;
}
</style>
