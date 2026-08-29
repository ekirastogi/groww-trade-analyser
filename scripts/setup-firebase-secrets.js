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

const project = process.argv.includes('--project')
  ? process.argv[process.argv.indexOf('--project') + 1]
  : 'growtrader-628a0';

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

try {
  console.log(`Setting FIREBASE_WEB_CONFIG secret on project ${project}...`);
  execSync(`firebase functions:secrets:set FIREBASE_WEB_CONFIG --project ${project} --data-file ${tmp}`, {
    stdio: 'inherit',
  });
  console.log('Secret saved. Deploy functions: firebase deploy --only functions');
} finally {
  fs.unlinkSync(tmp);
}
