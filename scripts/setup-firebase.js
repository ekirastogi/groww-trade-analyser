#!/usr/bin/env node
/**
 * Provision Firebase project resources via Firebase CLI:
 * - Firestore database (asia-south1)
 * - Firestore security rules + indexes
 * - Firebase web config in Secret Manager
 *
 * Usage: node scripts/setup-firebase.js [--project growtrader-628a0]
 */
const { execSync } = require('child_process');
const {
  projectId: defaultProject,
  firestoreLocation,
} = require('./firebase-project');

const project =
  process.argv.includes('--project') ?
    process.argv[process.argv.indexOf('--project') + 1]
  : defaultProject;

function run(command, options = {}) {
  execSync(command, { stdio: 'inherit', ...options });
}

function runCapture(command) {
  return execSync(command, { encoding: 'utf8' }).trim();
}

function hasFirestoreDatabase() {
  try {
    const output = runCapture(`firebase firestore:databases:list --project=${project}`);
    return output.includes('(default)');
  } catch {
    return false;
  }
}

console.log(`Setting up Firebase project: ${project}`);

run(`firebase use ${project}`);

if (!hasFirestoreDatabase()) {
  console.log(`Creating Firestore database in ${firestoreLocation}...`);
  run(
    `firebase firestore:databases:create "(default)" --location=${firestoreLocation} --project=${project}`
  );
} else {
  console.log('Firestore database already exists.');
}

console.log('Deploying Firestore rules and indexes...');
run(`firebase deploy --only firestore:rules,firestore:indexes --project=${project}`);

console.log('Uploading Firebase web config to Secret Manager...');
run('node scripts/setup-firebase-secrets.js', { cwd: __dirname + '/..' });

console.log('\nFirebase setup complete.');
console.log('- Firestore: rules and indexes deployed');
console.log('- Secret Manager: FIREBASE_WEB_CONFIG stored');
console.log('- Enable Google sign-in in Firebase Console if not already: Authentication > Sign-in method');
