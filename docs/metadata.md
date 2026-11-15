# Importing images and JSON metadata

**Add Image** accepts multiple image files, ZIP archives, and JSON metadata files.
Each image opens in a separate widget. ZIP images and JSON files are extracted
under Nova's application-data `imports` directory. These extracted files remain
there so scenarios can reopen them without the original ZIP. Drag and drop uses
the same import flow.

A single selected JSON file is shared with all images in that import. With multiple
JSON files, Nova matches product filename stems (including SICD/SIDD/metadata
suffixes) and explicit image references inside JSON. If no such match exists, a
sole JSON in an image's directory is used. Unmatched JSON is reported so it can be
attached manually; it is not silently assigned to unrelated images.

Select an image and choose **Data → Attach Metadata** in the contextual Image or Scientific Imagery tab to add one or more JSON
files later. This opens its Metadata panel. Attached files appear in expandable
sections, separately from embedded image metadata. Reattaching the same path
updates that attachment. Their file paths are saved with the scenario; missing
JSON files are marked unavailable without preventing the image from opening.

JSON files are limited to 5 MB, with at most 32 attachments per image/import.
ZIP import supports nested folders, skips unrelated files, and rejects paths that
escape the extraction directory. Archive limits are 10,000 entries and 50 GB of
extracted image/JSON data. One failed image does not prevent the remaining images
from opening.

## Axes from attached JSON

Attached metadata can supply the image axes used by **View → Axes**, hover
coordinates, and slice graphs. The embedded metadata is retained:

- Embedded axes remain active unless **Override embedded axes** is selected in
  an attached file's section of the Metadata panel.
- Without embedded axes, one unambiguous valid image-axes definition is applied
  automatically. Conflicting definitions require **Use these axes**.
- **Use embedded axes** or **Use pixel axes** restores the original coordinate
  system. Explicit selections are saved with the scenario.
- Unknown schemas, mismatched dimensions, invalid values, and unsupported units
  remain visible for reference but do not change the axes.

Axis-source changes update existing slice graph coordinates as well as new
slices. Scaling changes preserve the selected coordinate source. No image pixels
are rotated, resampled, georectified, or recalibrated by attaching JSON.

### Explicit image-axes schema

For any image, provide its exact source dimensions and an axis definition:

```json
{
    "image": {
        "name": "scene.tif",
        "width": 4096,
        "height": 2048
    },
    "axes": {
        "row": {
            "label": "Down-range",
            "unit": "m",
            "origin": -1024,
            "spacing": 1
        },
        "column": {
            "label": "Cross-range",
            "unit": "m",
            "origin": -2048,
            "spacing": 1
        }
    }
}
```

`image.name` is optional; when supplied it must match the image filename. Width
and height may alternatively be top-level fields. They must match the source
image, not a thumbnail. Rows are Y and columns are X. `origin` is the coordinate
at the **center of pixel zero**; `spacing` is the signed increment per source
pixel. Negative spacing is supported, for example when northing decreases down
an image. Both numbers must be finite, and spacing must be nonzero. Units must be
explicitly `m` or `pixel`.

Coordinate = origin + source pixel index × spacing.

These are declared coordinates for this exact pixel grid. Geographic degrees,
map transforms, corner-based origins, or vendor fields such as `resolution` are
not guessed to be meter axes. Project/convert those coordinates to the appropriate
image grid before supplying this schema.

### Exported SICD/SIDD JSON

Nova also recognizes these native metadata structures, either at the root or
wrapped in `SICD` / `SIDD`:

- SICD: `ImageData` dimensions, chip offsets and scene-center pixel, plus `Grid`
  type and row/column sample spacing. Labels and coordinates follow the same
  conventions as the embedded SICD reader.
- SIDD: `Measurement.PixelFootprint` and plane-projection sample spacing and
  reference pixel. Axes are labeled Row distance and Column distance.

These definitions can automatically fill missing axes on their corresponding
product format. When attached to another format, such as a TIFF export, they
require explicit selection: matching dimensions alone cannot establish that a
rendered or reprojected image uses the original source grid. Use these axes only
when the image has that same pixel grid. Otherwise provide the explicit schema
for the target image. Other vendor JSON and STAC metadata remain available for
reference until a specific coordinate mapping is supported.
