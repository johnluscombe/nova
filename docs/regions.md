# Polygon region statistics

Choose **Analysis → Polygon** in the contextual Scientific Imagery or Image tab.
Click vertices inside the image, then click the first vertex, double-click, or
press Enter to close the polygon. Backspace/Delete undoes a vertex; Escape cancels
the draft. Self-intersecting or zero-area polygons are rejected so the draft can
be corrected before it is applied.

Closing the polygon opens the Statistics pane and replaces whole-image
percentiles with percentiles for that region. The selected boundary remains
aligned with the image when resizing, showing axes, or opening side panels.
One closed polygon is supported per image widget. Draw again to replace it;
canceling a new draft preserves the previous region. **Clear Region** removes
both the selection and any draft and restores whole-image statistics.

## Values and sampling

SICD, SIDD, and TIFF images use source samples through Scientific Imagery. SICD
uses the selected scaling mode, including radiometric calibration where available.
Relative power uses the image preview's sampled peak reference, as pixel
inspection does. SIDD and TIFF use source intensity or RGB luminance.

Other image readers use preview luminance, explicitly labeled in Statistics.
PNG/JPG/SVG whole-preview percentiles are calculated automatically when the image
opens, so Statistics is available before drawing. For other preview-only readers,
clearing the region restores whole-preview percentiles even if the reader did
not initially provide statistics. Transparent pixels and
nonfinite or undefined values are excluded.

A pixel belongs to a region when its center lies inside or on the polygon
boundary. Vertices are stored in source image-edge coordinates: row increases
down and column increases right. Axes from embedded or attached metadata do not
change this pixel grid. Concave polygons are supported; crossing edges are not.

Source regions are read in bounded rows/blocks. Bounding boxes containing more
than 2,560,000 source pixels are sampled with a shared row/column stride, retaining
at most that many samples. The pane displays the finite sample count and marks
sampled results. Preview sampling is bounded to 1600 pixels per dimension. Empty
regions report no finite samples and show unavailable percentiles.

Changing image scaling recomputes the selected region. Closed polygons are saved
in the scenario and their statistics are recomputed when the image is reopened.
Unfinished drafts are temporary. Late results after clearing or closing a region
are ignored. Preview stretching and original image bytes are unchanged.

## Plugin API

An image plugin may implement:

```ts
readRegion(filePath, polygon, parameters, scaling?, peakPower?) {
    return {
        statistics: { "50th percentile": 42 },
        valueLabel: "Source amplitude",
        sampleCount: 100,
        sampled: false
    };
}
```

`polygon` has 3–256 `{ row, column }` vertices, without a repeated closing vertex.
Coordinates are finite, inside the source image, and describe a simple nonzero
area. Return finite numeric or null statistics and a quantity label with units.
The host validates the polygon, scaling mode, opened image, and returned result.
Without this handler, Nova falls back to preview sampling.
