import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

export async function applyMigrations(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(716395812)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const directory = new URL("../migrations/", import.meta.url);
    const files = (await readdir(directory))
      .filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file))
      .sort();
    if (!files.length) throw new Error("No migrations found");
    for (const filename of files) {
      const sql = await readFile(new URL(filename, directory), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query(
        "SELECT checksum FROM schema_migrations WHERE filename = $1",
        [filename],
      );
      if (existing.rows.length) {
        if (existing.rows[0].checksum !== checksum)
          throw new Error(`Applied migration changed: ${filename}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations(filename, checksum) VALUES ($1, $2)",
          [filename, checksum],
        );
        await client.query("COMMIT");
        console.log(`Applied ${filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(716395812)");
    } finally {
      client.release();
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await applyMigrations(pool);
  } finally {
    await pool.end();
  }
}
