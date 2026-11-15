import { ref, watch, type Ref, type ComputedRef } from "vue";
import type { ImageInfo } from "@/types/image";
import type { ImageWindow } from "@/types/image-window";

/**
 * Keep the formation navigator pinned while opening independently managed
 * product windows.
 */
export function useFormationProducts(
    windows: Ref<ImageWindow[]>,
    activeWidget: ComputedRef<ImageWindow | undefined>,
    add: (image: ImageInfo) => number,
    restore: (widget: ImageWindow) => void
) {
    const formationSidebarOpen = ref(true);
    const formationSource = ref<ImageInfo>();
    const selectedFormationProduct = ref("final");

    /**
     * Retain the last formation set independently of the active product
     * window.
     */
    function pinFormationSource(image: ImageInfo) {
        if (!image.formationProducts?.length) {
            return;
        }

        if (formationSource.value?.path !== image.path) {
            selectedFormationProduct.value = "final";
        }

        formationSource.value = {
            ...image,
            name: image.path.split(/[\\/]/).pop() || image.name
        };
    }

    /**
     * Open a diagnostic in its own window, or activate its existing window
     * without duplicating it.
     */
    function openFormationProduct(id: string) {
        const source = formationSource.value;
        const product = source?.formationProducts?.find(item => item.id === id);

        if (!source || !product) {
            return;
        }

        selectedFormationProduct.value = id;

        const existing = windows.value.find(
            widget =>
                !widget.graph &&
                widget.image.path === source.path &&
                (id === "final"
                    ? !widget.formationProductId ||
                      widget.formationProductId === "final"
                    : widget.formationProductId === id)
        );

        if (existing) {
            restore(existing);

            return;
        }

        const windowId = add({ ...source });
        const widget = windows.value.find(item => item.id === windowId)!;

        if (id !== "final") {
            widget.formationProductId = id;
            widget.image.name = `${product.title} · ${source.name}`;
        }
    }

    /**
     * Apply the diagnostic title to a restored product window without changing
     * its source file.
     */
    function productWindowImage(image: ImageInfo, id?: string): ImageInfo {
        const product = image.formationProducts?.find(
            item => item.id === id && id !== "final"
        );

        return product
            ? {
                  ...image,
                  name: `${product.title} · ${image.path.split(/[\\/]/).pop() || image.name}`
              }
            : image;
    }

    /**
     * Resolve a display-only intermediate product; return undefined for the
     * final image.
     */
    function diagnosticProduct(widget: ImageWindow) {
        return widget.image.formationProducts?.find(
            product =>
                product.id === widget.formationProductId &&
                product.id !== "final"
        );
    }

    watch(
        () => activeWidget.value?.image,
        image => {
            if (image) {
                pinFormationSource(image);
            }
        }
    );
    return {
        formationSidebarOpen,
        formationSource,
        selectedFormationProduct,
        pinFormationSource,
        openFormationProduct,
        productWindowImage,
        diagnosticProduct
    };
}
