/**
 * In-process PostgreSQL (PGlite) adapter.
 *
 * DEVELOPMENT AND TEST ONLY. PGlite is a real PostgreSQL compiled to WebAssembly
 * and is used so that the migrations and the SQL can be exercised without an
 * external database. Production never imports this file: the production adapter
 * lives in `src/server/db.js` and requires SUPABASE_DB_URL.
 *
 * The shape matches the production adapter exactly (`query`, `exec`,
 * `transaction`, `withConnection`, `ping`, `close`), so repositories cannot tell
 * the difference.
 */
export async function createPgliteDb({ dataDir } = {}) {
  const { PGlite } = await import('@electric-sql/pglite')
  const pglite = new PGlite(dataDir ? { dataDir } : undefined)

  const client = {
    async query(text, params = []) {
      const result = await pglite.query(text, params)
      const rows = result.rows ?? []
      // PGlite reports `affectedRows` for DML and leaves it at 0 for SELECT, so
      // prefer the row count whenever the statement returned rows.
      const rowCount = rows.length > 0 ? rows.length : (result.affectedRows ?? 0)
      return { rows, rowCount }
    },
    async exec(sql) {
      await pglite.exec(sql)
    },
  }

  return {
    kind: 'pglite',
    query: client.query,
    exec: client.exec,
    // PGlite is a single connection, so a transaction simply brackets the work.
    async transaction(fn) {
      await pglite.exec('BEGIN')
      try {
        const result = await fn(client)
        await pglite.exec('COMMIT')
        return result
      } catch (error) {
        await pglite.exec('ROLLBACK').catch(() => undefined)
        throw error
      }
    },
    async withConnection(fn) {
      return fn(client)
    },
    async ping() {
      await pglite.query('SELECT 1')
    },
    async close() {
      await pglite.close()
    },
    pglite,
  }
}
