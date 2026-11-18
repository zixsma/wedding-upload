// Google access token from a refresh token (replaces ScriptApp.getOAuthToken()).

let cached = { token: '', expires: 0 };
let pending = null;

export async function accessToken() {
  if (cached.token && Date.now() < cached.expires) return cached.token;
  if (!pending) pending = refresh().finally(() => { pending = null; });
  return pending;
}

async function refresh() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: need('GOOGLE_CLIENT_ID'),
      client_secret: need('GOOGLE_CLIENT_SECRET'),
      refresh_token: need('GOOGLE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    console.error('Token refresh failed', res.status, body);
    throw new Error('Could not sign in to Google Drive.');
  }
  // Refresh a minute early.
  cached = { token: body.access_token, expires: Date.now() + (body.expires_in - 60) * 1000 };
  return cached.token;
}

export function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing setting ${name} (see .env.example)`);
  return v;
}
