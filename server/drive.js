// Ruengrin ♥ Tanakrit — guest photo & video upload.
// Google Drive backend, ported from the old Apps Script Code.gs (see legacy/).
//
// Album: the first page shows everything in the folder. To hide a photo or
// video from the album, move it to the trash or into a subfolder.

import { accessToken, need } from './google.js';

// Largest single file a guest may upload (10 GB).
const MAX_BYTES = 10 * 1024 * 1024 * 1024;

// How many photos the album loads at a time.
const PAGE_SIZE = 36;

/** An error whose message is safe to show to guests. */
export class PublicError extends Error {}

const folderId = () => need('FOLDER_ID');

/** Origins allowed to upload, e.g. "https://photos.example.com" (comma-separated). */
function allowedOrigins() {
  return need('PUBLIC_ORIGIN').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
}

/**
 * Called by the page for each file. Creates a Drive "resumable upload session"
 * and returns its URL. The guest's browser then sends the file bytes straight
 * to Google Drive, so large videos never pass through this server.
 * Guests never receive the access token, only a one-file upload URL.
 */
export async function startUpload(file) {
  file = file || {};
  const type = String(file.type || '').toLowerCase();
  if (!/^(image|video)\/[a-z0-9.+-]+$/.test(type)) {
    throw new PublicError('Only photos and videos can be uploaded.');
  }

  const size = Number(file.size);
  if (!(size > 0)) throw new PublicError('This file is empty.');
  if (size > MAX_BYTES) throw new PublicError('This file is too large.');

  const origin = String(file.origin || '');
  if (!allowedOrigins().includes(origin)) {
    throw new PublicError('Unexpected page origin.');
  }

  const guest = clean(file.guest).slice(0, 60);
  const original = clean(file.name).slice(0, 120) || 'upload';
  const name = guest ? guest + ' - ' + original : original;

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + (await accessToken()),
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': type,
        'X-Upload-Content-Length': String(size),
        // Lets the guest's browser (on this origin) send the bytes directly.
        Origin: origin,
      },
      body: JSON.stringify({
        name,
        parents: [folderId()],
        mimeType: type,
        description: guest ? 'Uploaded by ' + guest : 'Uploaded by a guest',
        // Tag used by the album's "filter by name" buttons.
        appProperties: uploaderTag(guest),
      }),
    }
  );

  if (res.status !== 200) {
    console.error('Drive session error', res.status, await res.text().catch(() => ''));
    throw new PublicError('Google Drive could not start the upload. Please try again.');
  }

  const url = res.headers.get('location');
  if (!url) throw new PublicError('Google Drive did not return an upload link.');
  return url;
}

/**
 * Called by the album page. Lists photos & videos in the folder, newest first.
 * opts: { token: next-page token or null,
 *         by: a name key from listUploaders() to show one guest's uploads only,
 *         fresh: true to skip the 30 s cache }
 */
export async function listMedia(opts) {
  opts = opts || {};
  const token = typeof opts.token === 'string' && opts.token.length < 1000 ? opts.token : '';
  const by = typeof opts.by === 'string' && opts.by.length <= 200 ? opts.by : '';
  const cacheKey = 'album:first';
  const cacheable = !token && !by;
  if (cacheable && !opts.fresh) {
    const hit = cache.get(cacheKey);
    if (hit) return hit;
  }

  let q = baseQuery();
  if (by) {
    q += " and appProperties has { key='byKey' and value='" + by.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "' }";
  }
  const data = await driveList(q, 'nextPageToken,files(id,mimeType,description,appProperties)', PAGE_SIZE, token);
  const out = {
    items: (data.files || []).map(f => {
      const who = whoUploaded(f);
      return { id: f.id, video: /^video\//.test(f.mimeType), by: who.name, byKey: who.key };
    }),
    next: data.nextPageToken || null,
  };
  if (cacheable) cache.put(cacheKey, out, 30);
  return out;
}

/**
 * Called by the slideshow (?page=show) on the reception screen.
 * Returns { items: [{ id, video, by, byKey, t }], delayMin }, newest first (up to 1000).
 * Uploads newer than SHOW_DELAY_MINUTES (default 5) are held back, so there is
 * time to hide something (move it to the trash or a subfolder) before it is on
 * the big screen. The album itself still shows everything straight away.
 * No "fresh" option: the screen polls, so the 20 s cache always applies.
 */
export async function listShow() {
  const hit = cache.get('show');
  if (hit) return hit;
  const delayMin = showDelayMinutes();
  const data = await driveList(baseQuery(), 'files(id,mimeType,size,createdTime,description,appProperties)', 1000, '');
  const cutoff = Date.now() - delayMin * 60 * 1000;
  const items = [];
  (data.files || []).forEach(f => {
    const t = Date.parse(f.createdTime);
    if (!(t <= cutoff)) return;
    const who = whoUploaded(f);
    const video = /^video\//.test(f.mimeType);
    const it = { id: f.id, video, by: who.name, byKey: who.key, t };
    if (video) it.size = Number(f.size) || 0; // the page needs it to pick how to stream
    items.push(it);
  });
  // Optional browser API key (Drive API only, limited to this site). With it the
  // screen can stream videos of any size straight from Google; without it,
  // only videos under ~100 MB play (bigger ones show their still picture).
  const out = { items, delayMin, apiKey: process.env.GOOGLE_API_KEY || null };
  cache.put('show', out, 20);
  return out;
}

function showDelayMinutes() {
  const raw = process.env.SHOW_DELAY_MINUTES;
  const n = raw === undefined || raw === '' ? 5 : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 24 * 60) : 5;
}

/**
 * Called by the album page for the "filter by name" buttons.
 * Returns { total, people: [{ key, name, n }] } with the busiest uploaders first.
 * Guests who left the name empty are grouped under key '-'.
 */
export async function listUploaders(opts) {
  opts = opts || {};
  if (!opts.fresh) {
    const hit = cache.get('album:people');
    if (hit) return hit;
  }

  const people = {};
  let total = 0, token = '';
  do {
    const data = await driveList(baseQuery(), 'nextPageToken,files(description,appProperties)', 1000, token);
    (data.files || []).forEach(f => {
      const who = whoUploaded(f);
      const p = people[who.key] || (people[who.key] = { key: who.key, name: who.name, n: 0 });
      p.n++;
      total++;
    });
    token = data.nextPageToken || '';
  } while (token);

  const list = Object.values(people);
  list.sort((a, b) => (a.key === '-') - (b.key === '-') || b.n - a.n);
  const out = { total, people: list };
  cache.put('album:people', out, 60);
  return out;
}

/** Checks the folder and turns on "Anyone with the link: Viewer" so the album can show photos. */
export async function checkSetup() {
  const auth = { Authorization: 'Bearer ' + (await accessToken()) };
  const base = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(folderId());
  const res = await fetch(base + '?supportsAllDrives=true&fields=id,name,webViewLink,mimeType', { headers: auth });
  if (!res.ok) throw new Error('Could not open the folder: ' + res.status + ' ' + (await res.text()));
  const folder = await res.json();
  if (folder.mimeType !== 'application/vnd.google-apps.folder') throw new Error('FOLDER_ID is not a folder.');

  const perm = await fetch(base + '/permissions?supportsAllDrives=true', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'anyone', role: 'reader' }),
  });
  if (!perm.ok) throw new Error('Could not share the folder: ' + perm.status + ' ' + (await perm.text()));
  return folder;
}

function baseQuery() {
  return "'" + folderId() + "' in parents and trashed = false and " +
         "(mimeType contains 'image/' or mimeType contains 'video/')";
}

async function driveList(q, fields, pageSize, pageToken) {
  const params = new URLSearchParams({
    q,
    orderBy: 'createdTime desc',
    pageSize: String(pageSize),
    fields,
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  if (pageToken) params.set('pageToken', pageToken);

  const res = await fetch('https://www.googleapis.com/drive/v3/files?' + params, {
    headers: { Authorization: 'Bearer ' + (await accessToken()) },
  });
  if (res.status !== 200) {
    console.error('Album list error', res.status, await res.text().catch(() => ''));
    throw new PublicError('Could not load the album. Please try again.');
  }
  return res.json();
}

/** Who uploaded a file: from its name tag, or (older files) its description. */
function whoUploaded(f) {
  const props = f.appProperties || {};
  if (props.byKey) return { key: props.byKey, name: props.by || '' };
  const name = uploader(f.description);
  return { key: nameKey(name), name };
}

/** The name tag stored on each upload (see scripts/migrate-tags.js for older files). */
export function uploaderTag(guest) {
  return guest ? { by: fitBytes(guest, 110), byKey: nameKey(guest) } : { byKey: '-' };
}

/** The guest name from an "Uploaded by …" description ('' for no name). */
export function uploader(description) {
  const m = /^Uploaded by (.+)$/.exec(description || '');
  return m && m[1] !== 'a guest' ? m[1] : '';
}

/** Same name, typed with different capitals or spaces, gives the same key. '-' = no name. */
function nameKey(name) {
  const k = fitBytes(clean(name).toLowerCase(), 110);
  return k || '-';
}

/** Trims text to fit Drive's tag size limit (counted in bytes; Thai letters are 3 bytes). */
function fitBytes(s, max) {
  let out = '';
  for (const ch of String(s || '')) {
    if (Buffer.byteLength(out + ch) > max) break;
    out += ch;
  }
  return out;
}

function clean(s) {
  return String(s || '')
    .replace(/[\u0000-\u001f\u007f\/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tiny in-memory cache with expiry (replaces Apps Script CacheService). */
const cache = {
  map: new Map(),
  get(k) {
    const e = this.map.get(k);
    if (!e) return null;
    if (Date.now() > e.until) { this.map.delete(k); return null; }
    return e.value;
  },
  put(k, value, seconds) {
    this.map.set(k, { value, until: Date.now() + seconds * 1000 });
  },
};
