import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const root = process.cwd();
const migrations = [
  'supabase/migrations/202611040002_fx_casa_cambio.sql',
  'supabase/migrations/202611040003_fx_rpc.sql',
];

const db = new PGlite();

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

try {
  await db.exec(stubs);
  console.log('OK stubs auth/roles');

  for (const migration of migrations) {
    const sql = fs.readFileSync(path.join(root, migration), 'utf8');
    await db.exec(sql);
    console.log('OK', migration);
  }

  const tables = await db.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'fx_%'
    ORDER BY table_name
  `);
  console.log('Tablas fx:', tables.rows.map((row) => row.table_name).join(', '));

  const views = await db.query(`
    SELECT table_name
    FROM information_schema.views
    WHERE table_schema = 'public' AND table_name LIKE 'fx_%'
    ORDER BY table_name
  `);
  console.log('Vistas fx:', views.rows.map((row) => row.table_name).join(', '));

  const functions = await db.query(`
    SELECT routine_name
    FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name LIKE 'fx_%'
    ORDER BY routine_name
  `);
  console.log('Funciones fx:', functions.rows.map((row) => row.routine_name).join(', '));
} catch (error) {
  console.error('FALLO:', error.message);
  if (error.position) console.error('Posición:', error.position);
  process.exitCode = 1;
} finally {
  await db.close();
}
