// MySQL advisory locks are session-owned, not pool-owned. Keep every
// schema operation on the acquired session; never continue on lock error.
export async function withSchemaMigrationLock(pool, work) {
  const connection = await pool.getConnection();
  let acquired = false, reusable = false, succeeded = false;
  try {
    const [rows] = await connection.query("SELECT GET_LOCK('itk_schema_migrations_lock', 15) AS locked");
    if (rows?.length !== 1 || rows[0].locked !== 1) throw Error('SCHEMA_MIGRATION_LOCK_UNAVAILABLE');
    acquired = true;
    const result = await work(connection);
    succeeded = true;
    return result;
  } finally {
    try {
      if (acquired) {
        const [rows] = await connection.query("SELECT RELEASE_LOCK('itk_schema_migrations_lock') AS released");
        reusable = rows?.length === 1 && rows[0].released === 1;
      }
    } catch (_) { reusable = false; }
    // Unknown acquisition/release state is never returned to the pool.
    if (reusable) connection.release(); else connection.destroy();
    if (succeeded && !reusable) throw Error('SCHEMA_MIGRATION_LOCK_RELEASE_UNCONFIRMED');
  }
}
