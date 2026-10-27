import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { loadConfig } from '../../config/env.js';
import { log } from '../logging/logger.js';
import { restrictAuditEventPrivileges } from './audit-privileges.js';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');

export async function applyMigrationFiles(connection: Connection): Promise<void> {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      id BIGINT NOT NULL AUTO_INCREMENT,
      filename VARCHAR(255) NOT NULL,
      applied_at DATETIME(6) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_schema_migration_filename (filename)
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((filename) => filename.endsWith('.sql'))
    .sort();

  for (const filename of files) {
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM schema_migration WHERE filename = ?',
      [filename]
    );
    if (rows.length > 0) {
      continue;
    }

    const sql = await readFile(path.join(MIGRATIONS_DIR, filename), 'utf8');
    await connection.query(sql);
    await connection.query('INSERT INTO schema_migration (filename, applied_at) VALUES (?, UTC_TIMESTAMP(6))', [
      filename
    ]);
    log('info', 'Applied database migration', { event: 'migration.applied', filename });
  }
}

export async function applyMigrations(): Promise<void> {
  const config = loadConfig();
  const connection = await mysql.createConnection({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    multipleStatements: true
  });

  try {
    log('info', 'Applying migrations to MySQL', {
      event: 'migration.start',
      databaseHost: config.database.host,
      databasePort: config.database.port,
      databaseName: config.database.database
    });
    await applyMigrationFiles(connection);
    await applyAuditPrivileges(config);
  } finally {
    await connection.end();
  }
}

async function applyAuditPrivileges(config: ReturnType<typeof loadConfig>): Promise<void> {
  const adminUser = config.database.adminUser;
  const adminPassword = config.database.adminPassword;
  const privilegeConnection = await mysql.createConnection({
    host: config.database.host,
    port: config.database.port,
    user: adminUser ?? config.database.user,
    password: adminPassword ?? config.database.password,
    database: config.database.database
  });
  try {
    await restrictAuditEventPrivileges(
      privilegeConnection,
      config.database.database,
      config.database.user
    );
  } finally {
    await privilegeConnection.end();
  }
}

const isCli = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  applyMigrations()
    .then(() => {
      log('info', 'Migrations complete', { event: 'migration.complete' });
    })
    .catch((error: unknown) => {
      log('error', 'Migration failed', {
        event: 'migration.failed',
        error: error instanceof Error ? error.message : 'unknown'
      });
      process.exitCode = 1;
    });
}
