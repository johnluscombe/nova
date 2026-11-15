import { sqliteTable, text, type SQLiteTable } from "drizzle-orm/sqlite-core";

// Add scenario table definitions here using sqliteTable, then export them in schema.
export const workspaceState = sqliteTable("nova_workspace", {
    id: text("id").primaryKey(),
    windows: text("windows").notNull()
});
export const schema = { workspaceState } satisfies Record<string, SQLiteTable>;

/**
 * Return the application-declared tables available for scenario browsing.
 */
export function getScenarioTables(): SQLiteTable[] {
    return Object.values(schema).filter(table => table !== workspaceState);
}
