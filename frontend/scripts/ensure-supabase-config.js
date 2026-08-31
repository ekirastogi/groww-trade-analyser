#!/usr/bin/env node
/**
 * Ensures src/environments/supabase.config.ts exists before Angular runs.
 *
 * Local dev (npm start): uses your gitignored supabase.config.ts if present.
 * Production build: set SUPABASE_URL and SUPABASE_ANON_KEY env vars.
 */
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../src/environments/supabase.config.ts');
const examplePath = path.join(__dirname, '../src/environments/supabase.config.example.ts');

function writeConfigFromEnv() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');
  }
  fs.writeFileSync(
    configPath,
    '/** Generated from environment — DO NOT COMMIT */\n' +
      'export const supabaseConfig = {\n' +
      `  url: ${JSON.stringify(url)},\n` +
      `  anonKey: ${JSON.stringify(anonKey)},\n` +
      '};\n'
  );
}

const fromEnv = process.argv.includes('--from-env');

if (fromEnv) {
  try {
    writeConfigFromEnv();
    console.log('Wrote supabase.config.ts from environment variables.');
  } catch (err) {
    console.error('Could not generate Supabase config from environment.');
    if (err.message) console.error(err.message);
    process.exit(1);
  }
  process.exit(0);
}

if (fs.existsSync(configPath)) {
  console.log('Using local supabase.config.ts for development.');
  process.exit(0);
}

console.warn(
  'Missing src/environments/supabase.config.ts for local development.\n' +
    `Copy ${path.relative(process.cwd(), examplePath)} and add your Supabase anon key.\n` +
    'Or set SUPABASE_URL and SUPABASE_ANON_KEY and run with --from-env'
);
