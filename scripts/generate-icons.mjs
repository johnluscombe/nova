// Run on macOS: node scripts/generate-icons.mjs
import { execFileSync } from "node:child_process";
import {
    copyFileSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "public/branding/nova-logo.png");
const temporary = mkdtempSync(path.join(tmpdir(), "nova-icons-"));
const resize = (size, destination) => {
    execFileSync(
        "sips",
        ["-z", String(size), String(size), source, "--out", destination],
        { stdio: "pipe" }
    );
};

try {
    for (const size of [16, 32, 96, 128, 180, 256]) {
        resize(size, path.join(root, `public/icons/nova-${size}.png`));
    }
    resize(512, path.join(root, "src-electron/electron-assets/icons/nova.png"));
    copyFileSync(
        path.join(root, "public/icons/nova-96.png"),
        path.join(root, "src/assets/nova-logo.png")
    );
    // Quasar's development launcher also reads this conventional icon path.
    copyFileSync(
        path.join(root, "src-electron/electron-assets/icons/nova.png"),
        path.join(root, "src-electron/electron-assets/icons/icon.png")
    );

    // ICO supports embedded PNG images; retain PNG transparency at each size.
    const sizes = [16, 32, 128, 256];
    const images = sizes.map(size =>
        readFileSync(path.join(root, `public/icons/nova-${size}.png`))
    );
    const directory = Buffer.alloc(6 + 16 * images.length);
    directory.writeUInt16LE(1, 2);
    directory.writeUInt16LE(images.length, 4);
    let offset = directory.length;
    images.forEach((image, index) => {
        const entry = 6 + index * 16;
        directory[entry] = sizes[index] % 256;
        directory[entry + 1] = sizes[index] % 256;
        directory.writeUInt16LE(1, entry + 4);
        directory.writeUInt16LE(32, entry + 6);
        directory.writeUInt32LE(image.length, entry + 8);
        directory.writeUInt32LE(offset, entry + 12);
        offset += image.length;
    });
    const ico = Buffer.concat([directory, ...images]);
    writeFileSync(path.join(root, "public/nova.ico"), ico);
    writeFileSync(
        path.join(root, "src-electron/electron-assets/icons/nova.ico"),
        ico
    );

    // Modern ICNS elements embed PNG data directly.
    const chunks = [
        [128, "ic07"],
        [256, "ic08"],
        [512, "ic09"],
        [1024, "ic10"]
    ].map(([size, type]) => {
        const file = path.join(temporary, String(size) + ".png");
        resize(size, file);
        const image = readFileSync(file);
        const header = Buffer.alloc(8);
        header.write(type, 0, "ascii");
        header.writeUInt32BE(image.length + 8, 4);
        return Buffer.concat([header, image]);
    });
    const header = Buffer.alloc(8);
    header.write("icns", 0, "ascii");
    header.writeUInt32BE(
        8 + chunks.reduce((total, chunk) => total + chunk.length, 0),
        4
    );
    writeFileSync(
        path.join(root, "src-electron/electron-assets/icons/nova.icns"),
        Buffer.concat([header, ...chunks])
    );
} finally {
    rmSync(temporary, { recursive: true, force: true });
}
