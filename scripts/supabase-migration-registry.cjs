const fs = require('fs');
const path = require('path');

function migrationNameFromFile(fileName) {
  return fileName.replace(/\.sql$/i, '');
}

function migrationVersionFromFile(fileName) {
  const match = migrationNameFromFile(fileName).match(/^(\d+)/);
  if (!match) {
    throw new Error(`Migration filename must start with a timestamp: ${fileName}`);
  }
  return match[1];
}

async function isMigrationRegistered(client, fileName) {
  const name = migrationNameFromFile(fileName);
  const version = migrationVersionFromFile(fileName);
  const { rowCount } = await client.query(
    `SELECT 1 FROM supabase_migrations.schema_migrations
     WHERE name = $1 OR version = $2
     LIMIT 1`,
    [name, version],
  );
  return rowCount > 0;
}

async function isMigrationRegistryComplete(client, fileName) {
  const name = migrationNameFromFile(fileName);
  const version = migrationVersionFromFile(fileName);
  const { rows } = await client.query(
    `SELECT name, statements
     FROM supabase_migrations.schema_migrations
     WHERE version = $1
     LIMIT 1`,
    [version],
  );
  const row = rows[0];
  if (!row) return false;
  const hasName = typeof row.name === 'string' && row.name.length > 0;
  const hasStatements =
    Array.isArray(row.statements) && row.statements.length > 0 && row.statements[0];
  return hasName && hasStatements && row.name === name;
}

async function recordMigration(client, fileName, sql) {
  const name = migrationNameFromFile(fileName);
  const version = migrationVersionFromFile(fileName);

  const { rowCount } = await client.query(
    `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
     VALUES ($1, $2, ARRAY[$3]::text[])
     ON CONFLICT (version) DO UPDATE SET
       name = EXCLUDED.name,
       statements = EXCLUDED.statements
     WHERE supabase_migrations.schema_migrations.name IS NULL
        OR supabase_migrations.schema_migrations.name = ''
        OR supabase_migrations.schema_migrations.statements IS NULL
        OR cardinality(supabase_migrations.schema_migrations.statements) = 0`,
    [version, name, sql],
  );

  return { name, version, inserted: rowCount > 0 };
}

/** Force name + statements on schema_migrations (fixes dashboard "Name not available"). */
async function repairMigrationRegistry(client, fileName, sql) {
  const name = migrationNameFromFile(fileName);
  const version = migrationVersionFromFile(fileName);

  await client.query(
    `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
     VALUES ($1, $2, ARRAY[$3]::text[])
     ON CONFLICT (version) DO UPDATE SET
       name = EXCLUDED.name,
       statements = EXCLUDED.statements`,
    [version, name, sql],
  );

  return { name, version, status: 'registry_repaired' };
}

async function repairMigrations(client, fileNames, migrationsDir) {
  const results = [];
  for (const fileName of fileNames) {
    const name = migrationNameFromFile(fileName);
    const sqlPath = path.join(migrationsDir, fileName);
    const sql = fs.readFileSync(sqlPath, 'utf8');

    if (await isMigrationRegistryComplete(client, fileName)) {
      results.push({ fileName, name, status: 'already_complete' });
      continue;
    }

    const recorded = await repairMigrationRegistry(client, fileName, sql);
    results.push({ fileName, name, status: recorded.status });
  }
  return results;
}

module.exports = {
  migrationNameFromFile,
  migrationVersionFromFile,
  isMigrationRegistered,
  isMigrationRegistryComplete,
  recordMigration,
  repairMigrationRegistry,
  repairMigrations,
};
