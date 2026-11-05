import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const root = process.cwd();

const stubs = `
  CREATE SCHEMA IF NOT EXISTS auth;

  CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY,
    email text
  );

  CREATE OR REPLACE FUNCTION auth.uid()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  AS $$ SELECT '11111111-1111-1111-1111-111111111111'::uuid $$;

  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      CREATE ROLE anon;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      CREATE ROLE authenticated;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      CREATE ROLE service_role;
    END IF;
  END $$;
`;

async function validate(label, files) {
  const db = new PGlite();
  try {
    await db.exec(stubs);
    for (const file of files) {
      const sql = fs.readFileSync(path.join(root, file), 'utf8');
      await db.exec(sql);
      console.log(`OK ${label}: ${file}`);
    }

    const tables = await db.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'fx_%'
      ORDER BY table_name
    `);
    console.log(`  Tablas (${tables.rows.length}):`, tables.rows.map((row) => row.table_name).join(', '));

    const views = await db.query(`
      SELECT table_name
      FROM information_schema.views
      WHERE table_schema = 'public' AND table_name LIKE 'fx_%'
      ORDER BY table_name
    `);
    console.log(`  Vistas (${views.rows.length}):`, views.rows.map((row) => row.table_name).join(', '));

    const functions = await db.query(`
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_schema = 'public' AND routine_name LIKE 'fx_%'
      ORDER BY routine_name
    `);
    console.log(
      `  Funciones (${functions.rows.length}):`,
      functions.rows.map((row) => row.routine_name).join(', '),
    );
  } finally {
    await db.close();
  }
}

try {
  await validate('individual', [
    'supabase/migrations/202611040002_fx_casa_cambio.sql',
    'supabase/migrations/202611040003_fx_rpc.sql',
  ]);
  await validate('consolidado', ['supabase/apply_all.sql']);
  await validate('ascii', ['supabase/apply_all_ascii.sql']);
  await validate('patch', [
    'supabase/migrations/202611040002_fx_casa_cambio.sql',
    'supabase/migrations/202611040003_fx_rpc.sql',
    'supabase/patch_world_currencies.sql',
  ]);
  await validate('close-patch', [
    'supabase/migrations/202611040002_fx_casa_cambio.sql',
    'supabase/migrations/202611040003_fx_rpc.sql',
    'supabase/patch_close_expenses.sql',
  ]);
} catch (error) {
  console.error('FALLO:', error.message);
  process.exitCode = 1;
}
