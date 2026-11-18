// One-time: adds this app's name tag to photos & videos uploaded by the old
// Apps Script version. Drive hides another app's tags, so those files only
// have the "Uploaded by …" description.
//
//   node --env-file=.env scripts/migrate-tags.js           (shows what would change)
//   node --env-file=.env scripts/migrate-tags.js --apply   (writes the tags)
//
// Only files with no tag from this app are touched. Safe to run more than once.

import { accessToken, need } from '../server/google.js';
import { uploader, uploaderTag } from '../server/drive.js';

const apply = process.argv.includes('--apply');
const api = 'https://www.googleapis.com/drive/v3/files';

async function call(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: 'Bearer ' + (await accessToken()), ...init.headers },
  });
  if (!res.ok) throw new Error(res.status + ' ' + (await res.text()));
  return res.json();
}

const q = "'" + need('FOLDER_ID') + "' in parents and trashed = false and " +
          "(mimeType contains 'image/' or mimeType contains 'video/')";

let token = '', total = 0, todo = 0, done = 0;
do {
  const params = new URLSearchParams({
    q, pageSize: '1000', fields: 'nextPageToken,files(id,name,description,appProperties)',
    supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
  });
  if (token) params.set('pageToken', token);
  const data = await call(api + '?' + params);

  for (const f of data.files || []) {
    total++;
    if (f.appProperties && f.appProperties.byKey) continue;
    todo++;
    const tag = uploaderTag(uploader(f.description));
    console.log((apply ? 'tag  ' : 'would tag  ') + JSON.stringify(tag) + '  ' + f.name);
    if (apply) {
      await call(api + '/' + encodeURIComponent(f.id) + '?supportsAllDrives=true&fields=id', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ appProperties: tag }),
      });
      done++;
    }
  }
  token = data.nextPageToken || '';
} while (token);

console.log(`\n${total} files, ${todo} without a tag` + (apply ? `, ${done} tagged.` : '. Run with --apply to tag them.'));
