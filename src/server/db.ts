import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "./config";
type Connection = ReturnType<typeof Database>;
const connections = new Map<string, Connection>();
export const tables = [
  "batches",
  "documents",
  "versions",
  "reviews",
  "runs",
  "rewrites",
  "revisions",
  "usage",
  "analyses",
] as const;
export type Table = (typeof tables)[number];
export function db() {
  const dir = getConfig().dataDir;
  let connection = connections.get(dir);
  if (!connection) {
    fs.mkdirSync(dir, { recursive: true });
    connection = new Database(path.join(dir, "workspace.sqlite"));
    connection.pragma("journal_mode = WAL");
    connection.pragma("secure_delete = ON");
    connection.pragma("busy_timeout = 5000");
    for (const table of tables)
      connection.exec(
        `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
      );
    connection.exec(
      "CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, hash TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS metadata (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    connection
      .prepare("INSERT OR IGNORE INTO metadata VALUES ('generation', '1')")
      .run();
    connections.set(dir, connection);
  }
  return connection;
}
export function list<T>(table: Table): T[] {
  return db()
    .prepare(`SELECT data FROM ${table} ORDER BY rowid`)
    .all()
    .map((row) => JSON.parse((row as { data: string }).data));
}
export function get<T>(table: Table, id: string): T | null {
  const row = db().prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as
    { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}
export function put<T extends { id: string }>(table: Table, value: T) {
  db()
    .prepare(
      `INSERT INTO ${table}(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
    )
    .run(value.id, JSON.stringify(value));
  return value;
}
export function remove(table: Table, id: string) {
  db().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}
export function generation() {
  return Number(
    (
      db()
        .prepare("SELECT value FROM metadata WHERE id = 'generation'")
        .get() as { value: string }
    ).value,
  );
}
export function clearData(all: boolean) {
  const connection = db();
  connection.transaction(() => {
    for (const table of tables)
      if (all || table !== "usage") connection.exec(`DELETE FROM ${table}`);
    connection.exec("DELETE FROM operations");
    connection
      .prepare("UPDATE metadata SET value = ? WHERE id = 'generation'")
      .run(String(generation() + 1));
  })();
  connection.pragma("wal_checkpoint(TRUNCATE)");
  connection.exec("VACUUM");
}
export function closeDatabases() {
  for (const connection of connections.values()) connection.close();
  connections.clear();
}
