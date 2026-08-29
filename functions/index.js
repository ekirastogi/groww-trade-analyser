const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const firebaseWebConfig = defineSecret('FIREBASE_WEB_CONFIG');

exports.getFirebaseConfig = onRequest(
  {
    secrets: [firebaseWebConfig],
    cors: [/growtrader-628a0\.web\.app$/, /growtrader-628a0\.firebaseapp\.com$/, /localhost/],
  },
  (req, res) => {
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Origin', req.get('Origin') || '*');
      res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      res.status(204).send('');
      return;
    }

    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    try {
      const config = JSON.parse(firebaseWebConfig.value());
      res.set('Access-Control-Allow-Origin', req.get('Origin') || '*');
      res.set('Cache-Control', 'private, max-age=300');
      res.json(config);
    } catch (err) {
      console.error('Failed to read FIREBASE_WEB_CONFIG', err);
      res.status(500).json({ error: 'Config unavailable' });
    }
  }
);
