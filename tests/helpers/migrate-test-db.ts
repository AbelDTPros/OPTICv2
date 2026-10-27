import type { Connection } from 'mysql2/promise';
import { applyMigrationFiles } from '../../src/platform/db/migrate.js';

export async function applyMigrationsToConnection(connection: Connection): Promise<void> {
  await applyMigrationFiles(connection);
}