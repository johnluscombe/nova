import { axisCoordinate } from "../types/axes";
import type { ImageInfo } from "../types/image";
import type { SliceData, SliceOrientation } from "../types/slice";

/** Slice handlers return source pixel positions; display them in the image's axes. */
export function sliceAxes(
    data: SliceData,
    image: ImageInfo,
    orientation: SliceOrientation
): SliceData {
    const axis = image.axes?.[orientation === "horizontal" ? "column" : "row"];
    if (!axis) {
        return data;
    }
    return {
        ...data,
        positionLabel: `${axis.label} (${axis.unit})`,
        points: data.points.map(point => ({
            ...point,
            position: axisCoordinate(axis, point.position)
        }))
    };
}
export function slicePosition(
    image: ImageInfo,
    orientation: SliceOrientation,
    index: number
): string {
    const horizontal = orientation === "horizontal";
    const pixel = `${horizontal ? "row" : "column"} ${index}`;
    const axis = image.axes?.[horizontal ? "row" : "column"];
    if (!axis) {
        return pixel;
    }
    const value = Number(axisCoordinate(axis, index).toPrecision(7));
    return `${axis.label} ${value} ${axis.unit} (${pixel})`;
}
