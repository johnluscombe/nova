<template>
    <q-page class="scenario-page">
        <ScenarioRibbon
            :busy="busy"
            :has-scenario="!!scenario"
            :plugin-status="pluginStatus"
            :image-context="imageContext"
            :has-active-widget="hasActiveWidget"
            :has-slice-image="hasSliceImage"
            :has-active-statistics="hasActiveStatistics"
            :axes-active="axesActive"
            :pixel-values-active="pixelValuesActive"
            :slice-mode-active="sliceModeActive"
            :crop-state="cropState"
            :region-state="regionState"
            :scaling-state="scalingState"
            @new-scenario="newScenario"
            @open-scenario="openScenario()"
            @close-scenario="closeScenario"
            @open-image="openImage()"
            @color-scale="workspace?.openColorScale()"
            @save-image="workspace?.saveImage()"
            @settings="settingsOpen = true"
            @plugin-action="runPluginAction"
            @metadata="workspace?.toggleMetadata()"
            @axes="workspace?.toggleAxes()"
            @pixel-values="workspace?.togglePixelValues()"
            @statistics="workspace?.toggleStatistics()"
            @crop="workspace?.toggleCrop()"
            @polygon="workspace?.togglePolygon()"
            @clear-region="workspace?.clearRegion()"
            @slice="workspace?.toggleSlice()"
            @attach-metadata="workspace?.attachMetadata()"
            @form-sicd="formSicd"
            @create-sidd="createSidd"
            @scaling="workspace?.setScaling($event)" />
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import ScenarioRibbon from "@/components/application/ScenarioRibbon.vue";
import SettingsDialog from "@/components/application/SettingsDialog.vue";
import ImageWorkspace from "@/components/workspace/ImageWorkspace.vue";
import type { ImagePluginStatus } from "../types/image";
import type {
    ImageContext,
    ImageWorkspaceAPI,
    SavedImageWindow
} from "../types/workspace";
import type { ScenarioInfo } from "../types/scenario";
import { activeScenario as scenario } from "@/composables/useScenario";
import type { RegionState } from "@/types/region";
import type { ScalingState } from "@/types/scaling";

const scalingState = ref<ScalingState>({
    options: [],
    value: "amplitude",
    loading: false
});
const actionMessage = ref("");
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
const imageContext = ref<ImageContext>({ available: false, scientific: false });
const hasImageDecoders = computed(
    () =>
        pluginStatus.value?.plugins.some(plugin => plugin.extensions.length) ??
        false
);

/**
 * Execute a declared plugin action and surface its result or failure in
 * the workspace UI.
 */
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

/**
 * Refresh installed plugin status and report decoder discovery failures.
 */
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

/**
 * Send the latest window layout for persistence and track pending save failures.
 */
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

/**
 * Persist pending layout changes before switching documents or closing the
 * application.
 */
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

/**
 * Advertise copy semantics for supported native file drops when document
 * actions are available.
 */
function allowFileDrop(event: DragEvent) {
    event.preventDefault();

    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = busy.value ? "none" : "copy";
    }
}

/**
 * Resolve native dropped-file paths and route scenario files and imagery
 * to their import workflows.
 */
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

/**
 * Run image formation for the active CPHD while preventing overlapping
 * document actions.
 */
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

/**
 * Create a detected SIDD for the active SICD while keeping ribbon document
 * actions synchronized.
 */
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

/**
 * Import selected images, creating loading widgets and reconciling
 * progress with final results.
 */
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

/**
 * Replace the workspace with saved windows and complete their asynchronous
 * restoration.
 */
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

/**
 * Flush the current layout, choose a destination, and create a new
 * scenario.
 */
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

/**
 * Flush pending changes and open a selected or supplied scenario path.
 */
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

/**
 * Save pending window state before closing the document and clearing the
 * workspace.
 */
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
