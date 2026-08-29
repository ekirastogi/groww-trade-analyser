#!/usr/bin/env node
/**
 * Delete Firebase/GCP projects via Cloud Resource Manager API.
 * Uses credentials from `firebase login` (~/.config/configstore/firebase-tools.json).
 *
 * Usage: node scripts/delete-firebase-projects.js <project-id> [project-id...]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const FIREBASE_CLIENT_ID =
  '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CONFIG_PATH = path.join(os.homedir(), '.config/configstore/firebase-tools.json');

async function getAccessToken() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const { access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt } =
    config.tokens;

  if (accessToken && expiresAt && Date.now() < expiresAt - 60_000) {
    return accessToken;
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: FIREBASE_CLIENT_ID,
      client_secret: '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function deleteProject(projectId, accessToken) {
  const response = await fetch(
    `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (response.ok) {
    const body = await response.json();
    return { projectId, status: 'scheduled', body };
  }

  const errorText = await response.text();
  return { projectId, status: 'error', code: response.status, error: errorText };
}

async function main() {
  const projectIds = process.argv.slice(2);
  if (projectIds.length === 0) {
    console.error('Usage: node scripts/delete-firebase-projects.js <project-id> [...]');
    process.exit(1);
  }

  const accessToken = await getAccessToken();

  for (const projectId of projectIds) {
    console.log(`Deleting project ${projectId}...`);
    const result = await deleteProject(projectId, accessToken);
    if (result.status === 'scheduled') {
      console.log(`  Scheduled for deletion (30-day recovery window).`);
    } else {
      console.error(`  Failed (${result.code}): ${result.error}`);
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
