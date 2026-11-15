<template>
    <article
        v-show="!widget.minimized"
        class="image-window"
        :class="{ active: active }"
        :style="windowStyle"
        :aria-label="widget.image.name"
        @pointerdown="$emit('activate')"
        @focusin="$emit('activate')">
        <div
            class="widget-titlebar"
            tabindex="0"
            :aria-label="`${widget.image.name} window title. Use arrow keys to move.`"
            @pointerdown="$emit('moveStart', $event)"
            @pointermove="$emit('gestureMove', $event)"
            @pointerup="$emit('gestureEnd')"
            @pointercancel="$emit('gestureEnd')"
            @lostpointercapture="$emit('gestureEnd')"
            @dblclick="$emit('toggleMaximize')"
            @keydown="$emit('moveKey', $event)">
            <q-icon name="image" size="16px" />
            <span class="widget-title" :title="widget.image.path">
                {{ widget.image.name }}
            </span>
            <div
                class="widget-controls"
                @pointerdown.stop
                @dblclick.stop
                @keydown.stop>
                <q-btn
                    flat
                    dense
                    icon="remove"
                    :aria-label="`Minimize ${widget.image.name}`"
                    title="Minimize"
                    @click="$emit('minimize')" />
                <q-btn
                    flat
                    dense
                    :icon="widget.maximized ? 'filter_none' : 'crop_square'"
                    :aria-label="`${widget.maximized ? 'Restore' : 'Maximize'} ${widget.image.name}`"
                    :title="widget.maximized ? 'Restore' : 'Maximize'"
                    @click="$emit('toggleMaximize')" />
                <q-btn
                    flat
                    dense
                    icon="close"
                    class="widget-close"
                    :aria-label="`Close ${widget.image.name}`"
                    title="Close"
                    @click="$emit('close')" />
            </div>
        </div>
        <div class="widget-body"><slot /></div>
        <div class="widget-status" :title="widget.image.path">
            {{ widget.image.pluginName }}
            <span v-if="widget.image.width && widget.image.height">
                · {{ widget.image.width }} ×
                {{ widget.image.height }}
            </span>
        </div>
        <template v-if="!widget.maximized">
            <div
                v-for="edge in edges"
                :key="edge"
                class="resize-handle"
                :class="`resize-${edge}`"
                @pointerdown.stop="$emit('resizeStart', $event, edge)"
                @pointermove="$emit('gestureMove', $event)"
                @pointerup="$emit('gestureEnd')"
                @pointercancel="$emit('gestureEnd')"
                @lostpointercapture="$emit('gestureEnd')" />
            <button
                class="resize-keyboard"
                :aria-label="`Resize ${widget.image.name} with arrow keys`"
                @keydown="$emit('resizeKey', $event)">
                ⌟
            </button>
        </template>
    </article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ImageWindow } from "@/types/image-window";
import type { CanvasSize } from "@/utils/window-geometry";

const props = defineProps<{
    widget: ImageWindow;

    active: boolean;

    bounds: CanvasSize;
}>();
defineEmits<{
    activate: [];

    minimize: [];

    close: [];

    toggleMaximize: [];

    moveStart: [event: PointerEvent];

    resizeStart: [event: PointerEvent, edge: string];

    gestureMove: [event: PointerEvent];

    gestureEnd: [];

    moveKey: [event: KeyboardEvent];

    resizeKey: [event: KeyboardEvent];
}>();

const edges = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

/** Apply maximized or saved geometry without owning the workspace's window state. */
const windowStyle = computed(() => {
    const rect = props.widget.maximized
        ? { x: 0, y: 0, ...props.bounds }
        : props.widget.rect;
    return {
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        zIndex: props.widget.z
    };
});
</script>

<style scoped>
.image-window {
    position: absolute;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid #a9b7c7;
    border-radius: 6px;
    background: white;
    box-shadow: 0 3px 12px #20375426;
}

.image-window.active {
    border-color: #3979b9;
    box-shadow: 0 4px 18px #20375440;
}

.widget-titlebar {
    display: flex;
    gap: 8px;
    align-items: center;
    height: 32px;
    flex-shrink: 0;
    padding-left: 10px;
    background: #e2e9f1;
    color: #284663;
    cursor: move;
    touch-action: none;
    user-select: none;
}

.active .widget-titlebar {
    background: #234c78;
    color: white;
}

.widget-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
}

.widget-controls {
    display: flex;
    height: 100%;
    cursor: default;
}

.widget-controls :deep(.q-btn) {
    width: 32px;
    min-height: 0;
    border-radius: 0;
}

.widget-controls :deep(.q-icon) {
    font-size: 16px;
}

.widget-close:hover {
    background: #c42b1c;
    color: white;
}

.widget-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
}

.widget-status {
    flex-shrink: 0;
    font-size: 11px;
    padding: 3px 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.resize-handle {
    position: absolute;
    touch-action: none;
}

.resize-n,
.resize-s {
    height: 5px;
    left: 8px;
    right: 8px;
    cursor: ns-resize;
}

.resize-n {
    top: 0;
}

.resize-s {
    bottom: 0;
}

.resize-e,
.resize-w {
    width: 5px;
    top: 8px;
    bottom: 8px;
    cursor: ew-resize;
}

.resize-e {
    right: 0;
}

.resize-w {
    left: 0;
}

.resize-ne,
.resize-nw,
.resize-se,
.resize-sw {
    width: 9px;
    height: 9px;
}

.resize-ne {
    top: 0;
    right: 0;
    cursor: nesw-resize;
}

.resize-nw {
    top: 0;
    left: 0;
    cursor: nwse-resize;
}

.resize-se {
    bottom: 0;
    right: 0;
    cursor: nwse-resize;
}

.resize-sw {
    bottom: 0;
    left: 0;
    cursor: nesw-resize;
}

.resize-keyboard {
    position: absolute;
    bottom: 2px;
    right: 6px;
    padding: 0;
    line-height: 12px;
    border: 0;
    background: transparent;
    color: #647891;
    cursor: nwse-resize;
}
</style>
