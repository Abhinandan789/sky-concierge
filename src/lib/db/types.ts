/**
 * Minimal async database surface shared by the production Postgres pool and
 * the in-memory Postgres (PGlite) used in tests and local dev. Every method is
 * async so either driver can sit behind the same interface.
 */
export interface SkyDb {
  /** Execute a write statement; resolves to the number of affected rows. */
  run(sql: string, params?: unknown[]): Promise<number>;
  /** Execute a read; resolves to every returned row. */
  all<T extends object>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Execute a read; resolves to the first returned row, or undefined. */
  get<T extends object>(
    sql: string,
    params?: unknown[],
  ): Promise<T | undefined>;
  /** Execute one or more statements (schema/DDL). */
  exec(sql: string): Promise<void>;
  /** Release the underlying connection/resources. */
  close(): Promise<void>;
}
