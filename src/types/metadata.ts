export type JsonValue =
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | { [key: string]: JsonValue };
export interface MetadataAttachment {
    path: string;
    name: string;
    data?: unknown;
    error?: string;
}
