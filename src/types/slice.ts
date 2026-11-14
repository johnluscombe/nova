export type SliceOrientation = "horizontal" | "vertical";
export interface SliceData {
    points: { position: number; value: number | null }[];
    positionLabel: string;
    valueLabel: string;
}
export interface SliceSelection {
    orientation: SliceOrientation;
    index: number;
}
