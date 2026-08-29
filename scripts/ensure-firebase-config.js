#!/usr/bin/env node
/**
 * Ensures firebase.config.ts exists before build/serve.
 * Copies from firebase.config.example.ts if missing.
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../src/environments');
const target = path.join(dir, 'firebase.config.ts');
const example = path.join(dir, 'firebase.config.example.ts');

if (!fs.existsSync(target)) {
  if (fs.existsSync(example)) {
    fs.copyFileSync(example, target);
    console.warn(
      '\n⚠️  Created src/environments/firebase.config.ts from example.\n' +
      '   Add your Firebase web app credentials before deploying.\n'
    );
  } else {
    console.error('Missing firebase.config.example.ts');
    process.exit(1);
  }
}
