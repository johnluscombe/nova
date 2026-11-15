import type { Scaling } from "./scaling";

/** Source decoder and display representation used when converting an image file. */
export interface ImageSaveOptions {
    /** Decoder identity distinguishes scientific source samples from standard rasters. */
    pluginId?: string;

    /** Current scientific display scaling, applied when exporting a visual raster. */
    scaling?: Scaling;

    /** Full-size PNG rasterization of an SVG, produced in the renderer's image sandbox. */
    svgRaster?: string;
}
