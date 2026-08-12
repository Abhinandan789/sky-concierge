import { Pool } from "pg";
import { initSchema } from "./schema";
import type { SkyDb } from "./types";

/**
 * Postgres-backed adapter over a `pg` connection pool. SSL is enabled by
 * default for hosted providers (Neon) unless the connection string already
 * carries an `sslmode` parameter, which pg parses itself.
 */
export async function createPostgresDb(
  connectionString: string,
): Promise<SkyDb> {
  const config = /sslmode/i.test(connectionString)
    ? { connectionString }
    : { connectionString, ssl: { rejectUnauthorized: false } };
  const pool = new Pool(config);

  // Fail fast with a readable message instead of surfacing a raw pool error
  // on the first request.
  try {
    await pool.query("SELECT 1");
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw new Error(
      `Could not connect to the database — check DATABASE_URL. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const db: SkyDb = {
    async run(sql: string, params?: unknown[]) {
      const result = params
        ? await pool.query(sql, params)
        : await pool.query(sql);
      return result.rowCount ?? 0;
    },
    async all<T extends object>(sql: string, params?: unknown[]) {
      const result = params
        ? await pool.query(sql, params)
        : await pool.query(sql);
      return result.rows as T[];
    },
    async get<T extends object>(sql: string, params?: unknown[]) {
      const result = params
        ? await pool.query(sql, params)
        : await pool.query(sql);
      return result.rows[0] as T | undefined;
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async close() {
      await pool.end();
    },
  };

  await initSchema(db);
  return db;
}
