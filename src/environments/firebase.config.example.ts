/**
 * Template for local development.
 * Production builds fetch config from Google Secret Manager at build time.
 */
export const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  // Use your Firebase Hosting domain (e.g. project.web.app), not .firebaseapp.com, for mobile redirect sign-in.
  authDomain: 'YOUR_PROJECT.web.app',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};
