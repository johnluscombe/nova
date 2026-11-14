<template>
    <q-layout view="lHh Lpr lFf">
        <q-header class="nova-titlebar">
            <q-toolbar
                class="nova-toolbar"
                :class="{ 'nova-toolbar-mac': isMac }">
                <span
                    v-if="activeScenario"
                    class="text-caption scenario-name"
                    :title="activeScenario.name">
                    {{ activeScenario.name }}
                </span>
                <q-space />
                <div
                    v-if="controls && !isMac"
                    class="window-controls"
                    role="group"
                    aria-label="Window controls">
                    <q-btn
                        flat
                        square
                        dense
                        icon="remove"
                        aria-label="Minimize window"
                        title="Minimize"
                        @click="runWindowAction(() => controls!.minimize())" />
                    <q-btn
                        flat
                        square
                        dense
                        :icon="maximized ? 'filter_none' : 'crop_square'"
                        :aria-label="
                            maximized ? 'Restore window' : 'Maximize window'
                        "
                        :title="maximized ? 'Restore' : 'Maximize'"
                        @click="
                            runWindowAction(() => controls!.toggleMaximize())
                        " />
                    <q-btn
                        flat
                        square
                        dense
                        icon="close"
                        class="window-close"
                        aria-label="Close window"
                        title="Close"
                        @click="runWindowAction(() => controls!.close())" />
                </div>
            </q-toolbar>
        </q-header>
        <q-page-container>
            <q-banner
                v-if="windowError"
                class="bg-red-1 text-negative"
                role="alert">
                {{ windowError }}
            </q-banner>
            <router-view />
        </q-page-container>
    </q-layout>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import type { WindowState } from "@/types/window-controls";
import { activeScenario } from "@/composables/useScenario";

const controls = window.windowControls;
const isMac = controls?.platform === "darwin";
const maximized = ref(false);
const windowError = ref("");
let unsubscribe: (() => void) | undefined;
let mounted = false;
const updateState = (state: WindowState) => {
    maximized.value = state.maximized;
};

async function runWindowAction(action: () => Promise<unknown>) {
    windowError.value = "";
    try {
        await action();
    } catch {
        windowError.value = "Unable to update the window. Please try again.";
    }
}

onMounted(async () => {
    mounted = true;
    if (!controls) {
        return;
    }
    unsubscribe = controls.onStateChanged(updateState);
    await runWindowAction(async () => {
        const state = await controls.getState();
        if (mounted) {
            updateState(state);
        }
    });
});
onBeforeUnmount(() => {
    mounted = false;
    unsubscribe?.();
});
</script>

<style scoped>
.nova-titlebar {
    background: #234c78;
}
.nova-toolbar {
    height: 36px;
    min-height: 36px;
    padding-right: 0;
    -webkit-app-region: drag;
    app-region: drag;
    user-select: none;
}
.window-controls {
    display: flex;
    align-self: stretch;
    margin-left: 24px;
    -webkit-app-region: no-drag;
    app-region: no-drag;
}
.nova-toolbar-mac {
    /* Leave room for macOS's native close, minimize, and fullscreen buttons. */
    padding-left: 88px;
    padding-right: 16px;
}
.window-controls :deep(.q-btn) {
    width: 46px;
    border-radius: 0;
}
.window-close:hover,
.window-close:focus-visible {
    background: #c42b1c;
    color: white;
}
.scenario-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
