import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sqliteTable, blob, text } from "drizzle-orm/sqlite-core";
import { schema } from "../../src-electron/scenario-schema.ts";
import { ScenarioDatabase } from "../../src-electron/scenario-database.ts";

test("opens scenarios, pages records, preserves large integers, and rejects invalid files", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "nova-scenario-"));
    const file = path.join(directory, "test.scenario");
    const scenario = new ScenarioDatabase();

    // Register a predefined test schema without adding placeholder production tables.
    (
        schema as typeof schema & { records?: ReturnType<typeof sqliteTable> }
    ).records = sqliteTable('odd"table', {
        id: blob("id", { mode: "bigint" }),
        data: blob("data", { mode: "buffer" }),
        value: text("value")
    });

    try {
        const fixture = new DatabaseSync(file);

        fixture.exec(
            'CREATE TABLE "odd""table" (id BLOB, data BLOB, value TEXT)'
        );

        const insert = fixture.prepare(
            'INSERT INTO "odd""table" VALUES (?, ?, ?)'
        );

        for (let i = 0; i < 101; i++) {
            insert.run(
                new TextEncoder().encode("9223372036854775807"),
                new Uint8Array([1, 2]),
                null
            );
        }

        fixture.exec("CREATE TABLE undeclared (id INTEGER)");
        fixture.close();
        assert.deepEqual((await scenario.open(file)).tables, ['odd"table']);

        const first = scenario.readTable('odd"table', 0);

        assert.equal(first.rows.length, 100);
        assert.equal(first.hasMore, true);
        assert.deepEqual(first.rows[0], {
            id: "9223372036854775807",
            data: "[BLOB: 2 bytes]",
            value: null
        });
        assert.equal(scenario.readTable('odd"table', 100).hasMore, false);
        assert.throws(() => scenario.readTable("unknown", 0));
        assert.throws(() => scenario.readTable('odd"table', -1));
        await assert.rejects(
            scenario.open(path.join(directory, "missing.scenario"))
        );

        const invalid = path.join(directory, "invalid.scenario");

        writeFileSync(invalid, "This is not SQLite");
        await assert.rejects(scenario.open(invalid));
        assert.equal(scenario.readTable('odd"table', 0).rows.length, 100);
        await assert.rejects(scenario.open(path.join(directory, "test.txt")));
        scenario.close();
        assert.throws(() => scenario.readTable('odd"table', 0));
    } finally {
        scenario.close();
        delete (
            schema as typeof schema & {
                records?: ReturnType<typeof sqliteTable>;
            }
        ).records;
        rmSync(directory, { recursive: true, force: true });
    }
});

test("opens an empty scenario with an empty predefined schema", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "nova-empty-scenario-"));
    const file = path.join(directory, "empty.scenario");
    const scenario = new ScenarioDatabase();

    try {
        new DatabaseSync(file).close();
        assert.deepEqual(await scenario.open(file), {
            name: "empty.scenario",
            path: file,
            tables: []
        });
        assert.throws(() => scenario.readTable("unknown", 0));
    } finally {
        scenario.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("creates, saves, overwrites, and reopens an empty scenario", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "nova-save-"));
    const file = path.join(directory, "new.scenario");
    const scenario = new ScenarioDatabase();

    try {
        assert.deepEqual(scenario.create(), {
            name: "Untitled scenario",
            path: null,
            tables: []
        });
        await assert.rejects(
            scenario.save(path.join(directory, "missing", "fail.scenario"))
        );
        assert.equal(scenario.current!.path, null);
        await assert.rejects(scenario.save(path.join(directory, "wrong.txt")));

        const saved = await scenario.save(file);

        assert.equal(saved.path, file);
        assert.equal(saved.name, "new.scenario");
        await scenario.save(file);
        scenario.close();
        assert.deepEqual(await scenario.open(file), saved);
        scenario.close();
        await assert.rejects(scenario.save(file));
    } finally {
        scenario.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("saving an opened scenario preserves undeclared tables", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "nova-copy-"));
    const source = path.join(directory, "source.scenario");
    const destination = path.join(directory, "copy.scenario");
    const scenario = new ScenarioDatabase();

    try {
        const fixture = new DatabaseSync(source);

        fixture.exec(
            "CREATE TABLE retained (value TEXT); INSERT INTO retained VALUES ('keep me')"
        );
        fixture.close();
        await scenario.open(source);
        await scenario.save(destination);
        await scenario.save(destination);

        const copy = new DatabaseSync(destination, { readOnly: true });

        try {
            assert.equal(
                copy.prepare("SELECT value FROM retained").get()!.value,
                "keep me"
            );
        } finally {
            copy.close();
        }
    } finally {
        scenario.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("file-backed creation opens only after persistence and preserves the current scenario on failure", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "nova-create-"));
    const scenario = new ScenarioDatabase();

    try {
        const file = path.join(directory, "new.scenario");
        const info = await scenario.createFile(file);

        assert.equal(info.path, file);

        const reopened = new ScenarioDatabase();

        try {
            assert.deepEqual(await reopened.open(file), info);
        } finally {
            reopened.close();
        }

        await assert.rejects(
            scenario.createFile(
                path.join(directory, "missing", "fail.scenario")
            )
        );
        assert.deepEqual(scenario.current, info);
        await assert.rejects(
            scenario.createFile(path.join(directory, "wrong.txt"))
        );
        assert.deepEqual(scenario.current, info);
    } finally {
        scenario.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("autosaved workspace round-trips all window states and removes closed windows", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "nova-workspace-"));
    const scenario = new ScenarioDatabase();
    const file = path.join(directory, "layout.scenario");
    const windows = [
        {
            id: 1,
            path: "/images/a.png",
            pluginId: "nova.raster",
            rect: { x: 14, y: 25, width: 500, height: 300 },
            minimized: false,
            maximized: true,
            z: 4
        },
        {
            id: 2,
            path: "/images/b.svg",
            pluginId: "nova.vector",
            rect: { x: 80, y: 90, width: 400, height: 200 },
            minimized: true,
            maximized: false,
            z: 3
        }
    ];

    try {
        await scenario.createFile(file);
        assert.deepEqual(scenario.readWorkspace(), []);
        await scenario.saveWorkspace(windows);
        scenario.close();
        await scenario.open(file);
        assert.deepEqual(scenario.readWorkspace(), windows);
        await assert.rejects(
            scenario.saveWorkspace([
                {
                    ...windows[0],
                    rect: { x: -1, y: 0, width: 100, height: 100 }
                }
            ])
        );
        assert.deepEqual(scenario.readWorkspace(), windows);
        await scenario.saveWorkspace(windows.slice(0, 1));
        scenario.close();
        await scenario.open(file);
        assert.deepEqual(scenario.readWorkspace(), windows.slice(0, 1));
    } finally {
        scenario.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("corrupt saved layout does not replace an already open scenario", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "nova-corrupt-layout-"));
    const scenario = new ScenarioDatabase();

    try {
        const good = await scenario.createFile(
            path.join(directory, "good.scenario")
        );
        const broken = path.join(directory, "broken.scenario");
        const fixture = new DatabaseSync(broken);

        fixture.exec(
            "CREATE TABLE nova_workspace (id TEXT PRIMARY KEY, windows TEXT NOT NULL); INSERT INTO nova_workspace VALUES ('workspace', 'invalid JSON')"
        );
        fixture.close();
        await assert.rejects(scenario.open(broken));
        assert.deepEqual(scenario.current, good);
    } finally {
        scenario.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("workspace operations require an open persisted scenario", async () => {
    const scenario = new ScenarioDatabase();

    assert.throws(() => scenario.readWorkspace(), /Open a scenario first/);
    await assert.rejects(scenario.saveWorkspace([]), /Open a scenario first/);
    scenario.close();
});
