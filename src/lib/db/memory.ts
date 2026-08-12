import { PGlite } from "@electric-sql/pglite";
import { initSchema } from "./schema";
import type { SkyDb } from "./types";

/**
 * In-memory Postgres (PGlite — real Postgres compiled to WASM) used by tests
 * and as the local-dev fallback when DATABASE_URL is unset. Data is ephemeral:
 * it lives for the process lifetime only, which is exactly what serverless
 * deploy persistence needs *not* to be — production must set DATABASE_URL.
 */
export async function createMemoryDb(): Promise<SkyDb> {
  const db = new PGlite();
  const skyDb: SkyDb = {
    async run(sql: string, params?: unknown[]) {
      const result = await db.query(sql, params);
      return result.affectedRows ?? 0;
    },
    async all<T extends object>(sql: string, params?: unknown[]) {
      const result = await db.query(sql, params);
      return result.rows as T[];
    },
    async get<T extends object>(sql: string, params?: unknown[]) {
      const result = await db.query(sql, params);
      return result.rows[0] as T | undefined;
    },
    async exec(sql: string) {
      await db.exec(sql);
    },
    async close() {
      await db.close();
    },
  };

  await initSchema(skyDb);
  return skyDb;
}
