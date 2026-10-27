import type { Connection, RowDataPacket } from 'mysql2/promise';
import { log, logError } from '../logging/logger.js';

const SAFE_IDENT = /^[A-Za-z0-9_]+$/;
const SAFE_HOST = /^[A-Za-z0-9_.:%-]+$/;

const IGNORABLE_REVOKE_CODES = new Set([
  'ER_NONEXISTING_GRANT',
  'ER_NONEXISTING_TABLE_GRANT',
  'ER_TABLEACCESS_DENIED_ERROR',
  'ER_SPECIFIC_ACCESS_DENIED_ERROR',
  'ER_DBACCESS_DENIED_ERROR'
]);

/**
 * MySQL 9 partial revokes are schema-level only, so REVOKE UPDATE on
 * `db.audit_event` fails when the app user was granted `db.*`. Strip
 * UPDATE/DELETE at the schema, then grant them back on every other table.
 */
export async function restrictAuditEventPrivileges(
  connection: Connection,
  database: string,
  appUser: string
): Promise<boolean> {
  if (!SAFE_IDENT.test(database) || !SAFE_IDENT.test(appUser)) {
    log('warn', 'Skipped audit privilege restriction because identifiers were not safe', {
      event: 'audit.privileges_skipped'
    });
    return false;
  }

  const tables = await listSchemaTables(connection, database);
  if (!tables.includes('audit_event')) {
    log('warn', 'Skipped audit privilege restriction because audit_event is missing', {
      event: 'audit.privileges_skipped',
      database
    });
    return false;
  }

  const hosts = await listUserHosts(connection, appUser);
  let applied = false;
  for (const host of hosts) {
    if (!SAFE_HOST.test(host)) {
      continue;
    }
    try {
      const restricted = await restrictHost(connection, database, appUser, host, tables);
      if (restricted) {
        applied = true;
      }
    } catch (error: unknown) {
      logError('Could not revoke UPDATE/DELETE on audit_event', error, {
        event: 'audit.privileges_failed',
        appUser,
        host,
        errorCode: mysqlErrorCode(error)
      });
    }
  }
  if (applied) {
    await connection.query('FLUSH PRIVILEGES');
    log('info', 'Revoked UPDATE/DELETE on audit_event for the application user', {
      event: 'audit.privileges_applied',
      appUser,
      database
    });
  }
  return applied;
}

async function restrictHost(
  connection: Connection,
  database: string,
  appUser: string,
  host: string,
  tables: string[]
): Promise<boolean> {
  const account = `'${appUser}'@'${host}'`;
  for (const table of tables) {
    if (table === 'audit_event') {
      continue;
    }
    await connection.query(
      `GRANT UPDATE, DELETE ON \`${database}\`.\`${table}\` TO ${account}`
    );
  }
  await tryRevoke(
    connection,
    `REVOKE UPDATE, DELETE ON \`${database}\`.* FROM ${account}`
  );
  await tryRevoke(
    connection,
    `REVOKE UPDATE, DELETE ON \`${database}\`.audit_event FROM ${account}`
  );
  await connection.query(`GRANT SELECT, INSERT ON \`${database}\`.audit_event TO ${account}`);
  return accountCannotMutateAuditEvent(connection, appUser, host, database);
}

async function tryRevoke(connection: Connection, sql: string): Promise<void> {
  try {
    await connection.query(sql);
  } catch (error: unknown) {
    const code = mysqlErrorCode(error);
    if (code && IGNORABLE_REVOKE_CODES.has(code)) {
      return;
    }
    throw error;
  }
}

async function listSchemaTables(connection: Connection, database: string): Promise<string[]> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS name
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')`,
    [database]
  );
  return rows
    .map((row) => String(row.name))
    .filter((name) => SAFE_IDENT.test(name));
}

async function listUserHosts(connection: Connection, appUser: string): Promise<string[]> {
  try {
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT Host AS host FROM mysql.user WHERE User = ?',
      [appUser]
    );
    const hosts = rows.map((row) => String(row.host)).filter((host) => SAFE_HOST.test(host));
    if (hosts.length > 0) {
      return hosts;
    }
  } catch {
    // Fall back when the connected account cannot read mysql.user.
  }
  return ['%', 'localhost', '127.0.0.1'];
}

async function accountCannotMutateAuditEvent(
  connection: Connection,
  appUser: string,
  host: string,
  database: string
): Promise<boolean> {
  const [schemaRows] = await connection.query<RowDataPacket[]>(
    `SELECT Update_priv AS updatePriv, Delete_priv AS deletePriv
     FROM mysql.db
     WHERE User = ? AND Host = ? AND (Db = ? OR Db = ?)`,
    [appUser, host, database, database.replaceAll('_', '\\_')]
  );
  const schemaAllowsMutation = schemaRows.some(
    (row) => row.updatePriv === 'Y' || row.deletePriv === 'Y'
  );
  const [tableRows] = await connection.query<RowDataPacket[]>(
    `SELECT Table_priv AS tablePriv
     FROM mysql.tables_priv
     WHERE User = ? AND Host = ? AND (Db = ? OR Db = ?) AND Table_name = 'audit_event'`,
    [appUser, host, database, database.replaceAll('_', '\\_')]
  );
  const tableAllowsMutation = tableRows.some((row) => {
    const priv = String(row.tablePriv).toLowerCase();
    return priv.includes('update') || priv.includes('delete');
  });
  return !schemaAllowsMutation && !tableAllowsMutation;
}

function mysqlErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}
