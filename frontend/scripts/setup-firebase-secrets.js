#!/usr/bin/env node
/**
 * Upload Firebase web config JSON to Google Secret Manager (via Firebase CLI).
 * Reads from src/environments/firebase.config.ts (gitignored local file).
 *
 * Usage: node scripts/setup-firebase-secrets.js [--project growtrader-628a0]
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { projectId: defaultProject, secretName } = require('./firebase-project');

const project =
  process.argv.includes('--project') ?
    process.argv[process.argv.indexOf('--project') + 1]
  : defaultProject;

const configPath = path.join(__dirname, '../src/environments/firebase.config.ts');
if (!fs.existsSync(configPath)) {
  console.error('Missing src/environments/firebase.config.ts');
  console.error('Copy firebase.config.example.ts and add your Firebase web app values.');
  process.exit(1);
}

const content = fs.readFileSync(configPath, 'utf8');
const match = content.match(/export const firebaseConfig\s*=\s*(\{[\s\S]*?\});/);
if (!match) {
  console.error('Could not parse firebase.config.ts');
  process.exit(1);
}

let config;
try {
  config = Function(`"use strict"; return (${match[1]});`)();
} catch (err) {
  console.error('Invalid firebase.config.ts:', err.message);
  process.exit(1);
}

const json = JSON.stringify(config);
const tmp = path.join(__dirname, '../.firebase-web-config.secret.json');
fs.writeFileSync(tmp, json);

function run(command) {
  execSync(command, { stdio: 'inherit' });
}

try {
  console.log(`Uploading Firebase web config to Secret Manager (${project})...`);
  run(
    `firebase functions:secrets:set ${secretName} --project=${project} --data-file=${tmp}`
  );
  console.log('Secret saved. Production builds fetch it via: npm run secrets:fetch');
} finally {
  fs.unlinkSync(tmp);
}
