import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import type { ImageWindow } from "@/types/image-window";
import { validateColorScale, type ColorScale } from "@/types/color-scale";
import { colorizePreview } from "@/utils/color-scale";

/** Own per-image color controls and discard preview work for changed or closed windows. */
export function useColorScale(
    windows: Ref<ImageWindow[]>,
    active: ComputedRef<ImageWindow | undefined>,
    onError: (message: string) => void
) {
    const targetId = ref<number>();
    const target = computed(() =>
        windows.value.find(widget => widget.id === targetId.value)
    );
    const keys = new Map<
        number,
        { source: string | undefined; scale: string | undefined }
    >();
    const versions = new Map<number, number>();

    watch(
        () =>
            windows.value.map(widget => ({
                widget,
                source: widget.image.previewDataUrl,
                scale: JSON.stringify(widget.colorScale)
            })),
        entries => {
            for (const id of keys.keys()) {
                if (!entries.some(entry => entry.widget.id === id)) {
                    keys.delete(id);
                    versions.delete(id);
                }
            }

            for (const { widget, source, scale } of entries) {
                const previous = keys.get(widget.id);

                if (
                    previous &&
                    previous.source === source &&
                    previous.scale === scale
                ) {
                    continue;
                }
                keys.set(widget.id, { source, scale });
                const version = (versions.get(widget.id) ?? 0) + 1;

                versions.set(widget.id, version);
                delete widget.colorPreviewDataUrl;
                if (
                    !widget.colorScale ||
                    !widget.image.previewDataUrl ||
                    widget.image.pluginId === "nova.sicd"
                ) {
                    continue;
                }
                void colorizePreview(
                    widget.image.previewDataUrl,
                    widget.colorScale
                )
                    .then(url => {
                        if (
                            versions.get(widget.id) === version &&
                            windows.value.includes(widget)
                        ) {
                            widget.colorPreviewDataUrl = url;
                        }
                    })
                    .catch(cause => {
                        if (versions.get(widget.id) === version) {
                            onError(
                                cause instanceof Error
                                    ? cause.message
                                    : "Unable to color the image."
                            );
                        }
                    });
            }
        },
        { immediate: true }
    );

    /** Open controls for the current ready image; graphs and diagnostic slides are excluded. */
    function openColorScale() {
        const widget = active.value;

        if (
            widget &&
            !widget.loading &&
            !widget.graph &&
            (!widget.formationProductId ||
                widget.formationProductId === "final") &&
            widget.image.previewDataUrl
        ) {
            targetId.value = widget.id;
        }
    }

    /** Close the editor without changing its image. */
    function cancelColorScale() {
        targetId.value = undefined;
    }

    /** Update scientific previews in source units, or color standard-image luminance locally. */
    async function applyColorScale(value: ColorScale | undefined) {
        const widget = target.value;

        if (!widget || widget.loading) {
            return;
        }
        const scale = value ? validateColorScale(value) : undefined;

        targetId.value = undefined;
        widget.loading = true;
        try {
            if (
                scale &&
                widget.image.pluginId !== "nova.sicd" &&
                (scale.minimum ?? 0) >= (scale.maximum ?? 255)
            ) {
                throw new Error(
                    "The color scale minimum must be below its maximum."
                );
            }

            if (widget.image.pluginId === "nova.sicd") {
                const image = await window.images!.colorScale(
                    widget.image.path,
                    widget.image.pluginId,
                    scale,
                    widget.image.scaling
                );

                if (!windows.value.includes(widget)) {
                    return;
                }
                if (!image.previewDataUrl) {
                    throw new Error("The reader returned no color preview.");
                }

                widget.image = {
                    ...widget.image,
                    previewDataUrl: image.previewDataUrl,
                    ...(image.metadata ? { metadata: image.metadata } : {})
                };
            }

            if (scale) {
                widget.colorScale = scale;
            } else {
                delete widget.colorScale;
            }
        } catch (cause) {
            onError(
                cause instanceof Error
                    ? cause.message
                    : "Unable to change color scale."
            );
        } finally {
            widget.loading = false;
        }
    }

    return {
        colorScaleTarget: target,
        openColorScale,
        cancelColorScale,
        applyColorScale
    };
}
