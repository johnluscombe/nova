import { backup, DatabaseSync } from "node:sqlite";
import path from "node:path";
import { mkdtempSync, rmSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
    validateWorkspace,
    type SavedImageWindow
} from "../src/types/workspace.ts";
import { workspaceState } from "./scenario-schema.ts";
import { getScenarioTables } from "./scenario-schema.ts";
import type { ScenarioInfo, ScenarioRows } from "../src/types/scenario";

// SQLite's built-in catalog is used only to validate files, not discover app tables.
const sqliteCatalog = sqliteTable("sqlite_schema", { name: text("name") });

/**
 * Bind the scenario schema helpers to an existing SQLite connection.
 */
const connect = (client: DatabaseSync) => drizzle({ client });

/**
 * Ensure the workspace table exists in a new or migrated scenario
 * database.
 */
function migrate(client: DatabaseSync) {
    client.exec(
        "CREATE TABLE IF NOT EXISTS nova_workspace (id TEXT PRIMARY KEY, windows TEXT NOT NULL)"
    );
}

/**
 * Own a writable scenario copy and publish explicit saves to its SQLite file.
 */
export class ScenarioDatabase {
    private database: ReturnType<typeof connect> | undefined;

    private workingDirectory: string | undefined;
    private info: ScenarioInfo | undefined;

    /**
     * Return a detached description of the open scenario, or undefined
     * when none is open.
     */
    get current(): ScenarioInfo | undefined {
        return this.info
            ? { ...this.info, tables: [...this.info.tables] }
            : undefined;
    }

    /**
     * Replace the current working database with a new, unsaved in-memory
     * scenario.
     */
    create(): ScenarioInfo {
        const client = new DatabaseSync(":memory:");

        migrate(client);

        const database = connect(client);

        this.close();
        this.database = database;
        this.info = { name: "Untitled scenario", path: null, tables: [] };

        return this.current!;
    }

    /**
     * Create and save a scenario before replacing the current database
     * connection.
     */
    async createFile(filePath: string): Promise<ScenarioInfo> {
        const candidate = new ScenarioDatabase();

        try {
            candidate.create();

            const info = await candidate.save(filePath);

            this.close();
            this.database = candidate.database;
            this.info = info;
            candidate.database = undefined;

            return this.current!;
        } finally {
            candidate.close();
        }
    }

    /**
     * Validate a scenario and switch to an isolated writable working copy.
     *
     * The existing connection is retained until the new copy and persisted
     * workspace validate. The source file is opened read-only and is changed
     * only by a later save.
     */
    async open(filePath: string): Promise<ScenarioInfo> {
        if (path.extname(filePath).toLowerCase() !== ".scenario") {
            throw new Error("Choose a .scenario file.");
        }

        const source = new DatabaseSync(filePath, {
            readOnly: true,
            enableDoubleQuotedStringLiterals: false,
            allowExtension: false
        });
        let directory: string | undefined;
        let candidate: DatabaseSync | undefined;

        try {
            connect(source).select().from(sqliteCatalog).limit(1).all();
            directory = mkdtempSync(path.join(tmpdir(), "nova-working-"));

            const workingPath = path.join(directory, "working.sqlite");

            await backup(source, workingPath);
            candidate = new DatabaseSync(workingPath, {
                enableDoubleQuotedStringLiterals: false,
                allowExtension: false
            });
            migrate(candidate);

            const database = connect(candidate);
            const workspace = database.select().from(workspaceState).get();

            if (workspace) {
                validateWorkspace(JSON.parse(workspace.windows));
            }

            const tables = getScenarioTables().map(getTableName).sort();

            this.close();
            this.database = database;
            this.workingDirectory = directory;
            this.info = {
                name: path.basename(filePath),
                path: filePath,
                tables
            };

            return this.current!;
        } catch (error) {
            candidate?.close();

            if (directory) {
                rmSync(directory, { recursive: true, force: true });
            }

            throw error;
        } finally {
            source.close();
        }
    }

    /**
     * Back up the working database and atomically replace the requested
     * scenario.
     *
     * @param filePath - Destination with a .scenario extension.
     * @returns Updated scenario information after the completed backup has
     * been published.
     * @throws Error when no scenario is open, the extension is invalid, or a
     * disk operation fails.
     */
    async save(filePath: string): Promise<ScenarioInfo> {
        if (!this.database || !this.info) {
            throw new Error("Open a scenario first.");
        }

        if (path.extname(filePath).toLowerCase() !== ".scenario") {
            throw new Error("Choose a .scenario file.");
        }

        // Finish the SQLite backup before replacing an existing destination.
        const directory = mkdtempSync(
            path.join(path.dirname(filePath), ".nova-save-")
        );

        try {
            const stagedPath = path.join(directory, "saved.scenario");

            await backup(this.database.$client, stagedPath);
            renameSync(stagedPath, filePath);
            this.info = {
                ...this.info,
                name: path.basename(filePath),
                path: filePath
            };

            return this.current!;
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    }

    /**
     * Decode and validate persisted window state, returning an empty
     * workspace when none is stored.
     */
    readWorkspace(): SavedImageWindow[] {
        if (!this.database) {
            throw new Error("Open a scenario first.");
        }

        const row = this.database.select().from(workspaceState).get();

        return row ? validateWorkspace(JSON.parse(row.windows)) : [];
    }

    /**
     * Validate window state, update the workspace row, and save the
     * working scenario to disk.
     */
    async saveWorkspace(windows: unknown): Promise<void> {
        if (!this.database || !this.info?.path) {
            throw new Error("Open a scenario first.");
        }

        const checked = validateWorkspace(windows);

        this.database
            .insert(workspaceState)
            .values({ id: "workspace", windows: JSON.stringify(checked) })
            .onConflictDoUpdate({
                target: workspaceState.id,
                set: { windows: JSON.stringify(checked) }
            })
            .run();
        await this.save(this.info.path);
    }

    /**
     * Read a bounded page from a declared scenario table using a
     * nonnegative row offset.
     */
    readTable(table: string, offset: number): ScenarioRows {
        if (!this.database) {
            throw new Error("Open a scenario first.");
        }

        const definition = getScenarioTables().find(
            definition => getTableName(definition) === table
        );

        if (!definition) {
            throw new Error("Unknown scenario table.");
        }

        if (!Number.isSafeInteger(offset) || offset < 0) {
            throw new Error("Invalid row offset.");
        }

        const records = this.database
            .select()
            .from(definition)
            .limit(101)
            .offset(offset)
            .all();

        return {
            columns: Object.keys(getTableColumns(definition)),
            rows: records
                .slice(0, 100)
                .map(record =>
                    Object.fromEntries(
                        Object.entries(record).map(([key, value]) => [
                            key,
                            typeof value === "bigint"
                                ? value.toString()
                                : value instanceof Uint8Array
                                  ? `[BLOB: ${value.byteLength} bytes]`
                                  : value
                        ])
                    )
                ),
            hasMore: records.length > 100
        };
    }

    /**
     * Close the working database and remove its temporary directory,
     * clearing current scenario state.
     */
    close(): void {
        this.database?.$client.close();
        this.database = undefined;
        this.info = undefined;

        if (this.workingDirectory) {
            rmSync(this.workingDirectory, { recursive: true, force: true });
            this.workingDirectory = undefined;
        }
    }
}
