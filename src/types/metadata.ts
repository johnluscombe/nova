/**
 * Recursive JSON-compatible value, excluding undefined, functions, and class
 * instances.
 */
export type JsonValue =
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | { [key: string]: JsonValue };

/**
 * A JSON sidecar associated with an image. Read or parse failures are retained
 * alongside its identity for display.
 */
export interface MetadataAttachment {
    path: string;

    name: string;

    /**
     * Parsed JSON payload, kept unknown until a consumer validates its schema.
     */
    data?: unknown;

    /** Read or parse failure; other attachments remain usable. */
    error?: string;
}
