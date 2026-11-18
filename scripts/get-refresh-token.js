// One-time: sign in with the Google account that owns the Drive folder and print a refresh token.
//
//   node scripts/get-refresh-token.js
//
// Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (a "Desktop app" OAuth client) in .env.
// Open the printed link in a browser on the SAME machine (or forward port 8765 over SSH:
// ssh -L 8765:localhost:8765 your-server).

import http from 'node:http';
import crypto from 'node:crypto';

try { process.loadEnvFile(); } catch { /* settings from environment */ }

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.');
  process.exit(1);
}

const PORT = Number(process.env.OAUTH_PORT) || 8765;
const redirectUri = `http://localhost:${PORT}`;
const state = crypto.randomBytes(16).toString('hex');
const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: 'https://www.googleapis.com/auth/drive',
  access_type: 'offline',
  prompt: 'consent',
  state,
  code_challenge: challenge,
  code_challenge_method: 'S256',
});

const server = http.createServer(async (req, res) => {
  const q = new URL(req.url, redirectUri).searchParams;
  if (!q.get('code') && !q.get('error')) { res.writeHead(404).end(); return; }
  if (q.get('state') !== state || q.get('error')) {
    res.end('Sign-in failed: ' + (q.get('error') || 'state mismatch') + '. Close this tab and try again.');
    console.error('Sign-in failed:', q.get('error') || 'state mismatch');
    return finish(1);
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: q.get('code'),
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  const body = await tokenRes.json();
  if (!body.refresh_token) {
    res.end('No refresh token returned. See the terminal.');
    console.error('No refresh token returned:', body);
    return finish(1);
  }
  res.end('Done! You can close this tab and go back to the terminal.');
  console.log('\n✅ Add this line to your .env file:\n');
  console.log('GOOGLE_REFRESH_TOKEN=' + body.refresh_token + '\n');
  finish(0);
});

function finish(code) {
  server.close(() => process.exit(code));
  server.closeAllConnections();
}

server.listen(PORT, () => {
  console.log('Open this link and sign in with the Google account that owns the Drive folder:\n');
  console.log(authUrl + '\n');
});
