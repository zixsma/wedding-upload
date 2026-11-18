/**
 * Ruengrin ♥ Tanakrit — guest photo & video upload
 * Google Apps Script backend.
 *
 * 1. Paste the ID of your Google Drive folder below.
 * 2. Run `checkSetup` once to authorize (this also turns on the album, see below).
 * 3. Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 *
 * Album: the first page shows everything in the folder. To hide a photo or
 * video from the album, move it to the trash or into a subfolder.
 */

const FOLDER_ID = 'PASTE_YOUR_FOLDER_ID_HERE';

// Largest single file a guest may upload (10 GB).
const MAX_BYTES = 10 * 1024 * 1024 * 1024;

// How many photos the album loads at a time.
const PAGE_SIZE = 36;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Ruengrin ♥ Tanakrit · Guest album')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Called by the page for each file. Creates a Drive "resumable upload session"
 * and returns its URL. The guest's browser then sends the file bytes straight
 * to Google Drive, so large videos never pass through Apps Script.
 * Guests never receive your access token, only a one-file upload URL.
 */
function startUpload(file) {
  const type = String(file.type || '').toLowerCase();
  if (!/^(image|video)\//.test(type)) {
    throw new Error('Only photos and videos can be uploaded.');
  }

  const size = Number(file.size);
  if (!(size > 0)) throw new Error('This file is empty.');
  if (size > MAX_BYTES) throw new Error('This file is too large.');

  const origin = String(file.origin || '');
  if (!/^https:\/\/[a-z0-9-]+\.googleusercontent\.com$/.test(origin)) {
    throw new Error('Unexpected page origin.');
  }

  const guest = clean_(file.guest).slice(0, 60);
  const original = clean_(file.name).slice(0, 120) || 'upload';
  const name = guest ? guest + ' - ' + original : original;

  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
    {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      payload: JSON.stringify({
        name: name,
        parents: [FOLDER_ID],
        mimeType: type,
        description: guest ? 'Uploaded by ' + guest : 'Uploaded by a guest',
        // Tag used by the album's "filter by name" buttons.
        appProperties: guest ? { by: fitBytes_(guest, 110), byKey: nameKey_(guest) } : { byKey: '-' },
      }),
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
        'X-Upload-Content-Type': type,
        'X-Upload-Content-Length': String(size),
        // Lets the guest's browser (on this origin) send the bytes directly.
        Origin: origin,
      },
      muteHttpExceptions: true,
    }
  );

  if (res.getResponseCode() !== 200) {
    console.error('Drive session error', res.getResponseCode(), res.getContentText());
    throw new Error('Google Drive could not start the upload. Please try again.');
  }

  const headers = res.getAllHeaders();
  const url = headers.Location || headers.location;
  if (!url) throw new Error('Google Drive did not return an upload link.');
  return url;
}

/**
 * Called by the album page. Lists photos & videos in the folder, newest first.
 * opts: { token: next-page token or null,
 *         by: a name key from listUploaders() to show one guest's uploads only,
 *         fresh: true to skip the 30 s cache }
 */
function listMedia(opts) {
  opts = opts || {};
  const token = typeof opts.token === 'string' && opts.token.length < 1000 ? opts.token : '';
  const by = typeof opts.by === 'string' && opts.by.length <= 200 ? opts.by : '';
  const cache = CacheService.getScriptCache();
  const cacheKey = 'album:first';
  const cacheable = !token && !by;
  if (cacheable && !opts.fresh) {
    const hit = cache.get(cacheKey);
    if (hit) return JSON.parse(hit);
  }

  let q = BASE_QUERY_();
  if (by) {
    q += " and appProperties has { key='byKey' and value='" + by.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "' }";
  }
  const data = driveList_(q, 'nextPageToken,files(id,mimeType,description,appProperties)', PAGE_SIZE, token);
  const out = {
    items: (data.files || []).map(function (f) {
      const who = whoUploaded_(f);
      return { id: f.id, video: /^video\//.test(f.mimeType), by: who.name, byKey: who.key };
    }),
    next: data.nextPageToken || null,
  };
  if (cacheable) cache.put(cacheKey, JSON.stringify(out), 30);
  return out;
}

/**
 * Called by the album page for the "filter by name" buttons.
 * Returns { total, people: [{ key, name, n }] } with the busiest uploaders first.
 * Guests who left the name empty are grouped under key '-'.
 */
function listUploaders(opts) {
  opts = opts || {};
  const cache = CacheService.getScriptCache();
  if (!opts.fresh) {
    const hit = cache.get('album:people');
    if (hit) return JSON.parse(hit);
  }

  const people = {};
  let total = 0, token = '';
  do {
    const data = driveList_(BASE_QUERY_(), 'nextPageToken,files(description,appProperties)', 1000, token);
    (data.files || []).forEach(function (f) {
      const who = whoUploaded_(f);
      const p = people[who.key] || (people[who.key] = { key: who.key, name: who.name, n: 0 });
      p.n++;
      total++;
    });
    token = data.nextPageToken || '';
  } while (token);

  const list = Object.keys(people).map(function (k) { return people[k]; });
  list.sort(function (a, b) { return (a.key === '-') - (b.key === '-') || b.n - a.n; });
  const out = { total: total, people: list };
  const json = JSON.stringify(out);
  if (json.length < 90000) cache.put('album:people', json, 60);
  return out;
}

function BASE_QUERY_() {
  return "'" + FOLDER_ID + "' in parents and trashed = false and " +
         "(mimeType contains 'image/' or mimeType contains 'video/')";
}

function driveList_(q, fields, pageSize, pageToken) {
  const params = {
    q: q,
    orderBy: 'createdTime desc',
    pageSize: pageSize,
    fields: fields,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  };
  if (pageToken) params.pageToken = pageToken;
  const query = Object.keys(params)
    .map(function (k) { return k + '=' + encodeURIComponent(params[k]); })
    .join('&');

  const res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files?' + query, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    console.error('Album list error', res.getResponseCode(), res.getContentText());
    throw new Error('Could not load the album. Please try again.');
  }
  return JSON.parse(res.getContentText());
}

/** Who uploaded a file: from its name tag, or (older files) its description. */
function whoUploaded_(f) {
  const props = f.appProperties || {};
  if (props.byKey) return { key: props.byKey, name: props.by || '' };
  const name = uploader_(f.description);
  return { key: nameKey_(name), name: name };
}

/**
 * Run once from the editor: authorizes the script, checks the folder ID, and
 * sets the folder to "Anyone with the link: Viewer" so the album can show the
 * photos. Guests never see the folder link, only the page.
 */
function checkSetup() {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  console.log('✅ Uploads will go to: "' + folder.getName() + '"  ' + folder.getUrl());
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  console.log('✅ Album is on: anyone with the page link can view the photos & videos in this folder.');
}

function uploader_(description) {
  const m = /^Uploaded by (.+)$/.exec(description || '');
  return m && m[1] !== 'a guest' ? m[1] : '';
}

/** Same name, typed with different capitals or spaces, gives the same key. '-' = no name. */
function nameKey_(name) {
  const k = fitBytes_(clean_(name).toLowerCase(), 110);
  return k || '-';
}

/** Trims text to fit Drive's tag size limit (counted in bytes; Thai letters are 3 bytes). */
function fitBytes_(s, max) {
  let out = '';
  for (const ch of String(s || '')) {
    if (Utilities.newBlob(out + ch).getBytes().length > max) break;
    out += ch;
  }
  return out;
}

function clean_(s) {
  return String(s || '')
    .replace(/[\u0000-\u001f\u007f\/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
