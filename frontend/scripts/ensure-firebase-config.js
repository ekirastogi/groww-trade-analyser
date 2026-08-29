#!/usr/bin/env node
/**
 * Ensures src/environments/firebase.config.ts exists before Angular runs.
 *
 * Local dev (npm start): uses your gitignored firebase.config.ts if present.
 * Production build: fetches FIREBASE_WEB_CONFIG from Secret Manager via Firebase CLI.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { projectId, secretName, webAppId } = require('./firebase-project');

const fromSecrets = process.argv.includes('--from-secrets');
const configPath = path.join(__dirname, '../src/environments/firebase.config.ts');
const examplePath = path.join(__dirname, '../src/environments/firebase.config.example.ts');

function writeConfigTs(config) {
  const ts = JSON.stringify(config, null, 2).replace(/"([^"]+)":/g, '$1:');
  fs.writeFileSync(
    configPath,
    '/** Generated from Google Secret Manager — DO NOT COMMIT */\n' +
      `export const firebaseConfig = ${ts};\n`
  );
}

function fetchFromSecretManager() {
  const json = execSync(
    `firebase functions:secrets:access ${secretName} --project=${projectId}`,
    { encoding: 'utf8' }
  );
  return JSON.parse(json.trim());
}

function fetchFromFirebaseCli() {
  const output = execSync(
    `firebase apps:sdkconfig WEB ${webAppId} --project=${projectId}`,
    { encoding: 'utf8' }
  );
  const match = output.match(/firebase\.initializeApp\((\{[\s\S]*?\})\);/);
  if (!match) {
    throw new Error('Could not parse firebase apps:sdkconfig output');
  }
  const config = JSON.parse(match[1]);
  delete config.projectNumber;
  delete config.version;
  return config;
}

if (fromSecrets) {
  try {
    const config = fetchFromSecretManager();
    writeConfigTs(config);
    console.log(`Fetched Firebase config from Secret Manager (${projectId}).`);
  } catch (secretErr) {
    try {
      const config = fetchFromFirebaseCli();
      writeConfigTs(config);
      console.log(
        `Secret ${secretName} not found. Fetched Firebase config via Firebase CLI instead.`
      );
      console.log('Run: npm run secrets:setup to store it in Secret Manager.');
    } catch (cliErr) {
      console.error('Could not fetch Firebase config.');
      console.error('Run: npm run firebase:setup');
      console.error('Ensure you are logged in: firebase login');
      if (secretErr.message) {
        console.error(secretErr.message);
      }
      if (cliErr.message) {
        console.error(cliErr.message);
      }
      process.exit(1);
    }
  }
  process.exit(0);
}

if (fs.existsSync(configPath)) {
  console.log('Using local firebase.config.ts for development.');
  process.exit(0);
}

console.warn(
  'Missing src/environments/firebase.config.ts for local development.\n' +
    `Copy ${path.relative(process.cwd(), examplePath)} and add your Firebase web app values.\n` +
    'Or run: npm run secrets:fetch'
);
