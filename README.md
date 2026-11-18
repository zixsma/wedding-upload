# Ruengrin ♥ Tanakrit: guest album & upload

A small web site for your guests, with two pages:

1. **Album (first page):** everyone's photos and videos, newest first. Tap one to see it full screen, swipe for the next, and tap **Open** to download the original.
   A row of name buttons above the photos (**All · ⭐ Mine · Mint · ป้าแดง …**) shows just one guest's uploads. Tapping the name under a photo in the full-screen view does the same.
2. **Upload:** guests pick photos and videos on their phones, and the files go straight into a folder in your Google Drive.

Guests don't need to sign in. The site runs on your own home server, on your own domain, through a Cloudflare Tunnel. Files are still stored in Google Drive.

## How it works

```
Guest phone ──HTTPS──> Cloudflare ──tunnel──> cloudflared ──> Node server (port 8080)
     │                                                        ├─ GET  /                   the page
     │                                                        └─ POST /api/startUpload, /api/listMedia, /api/listUploaders
     ├──PUT 8 MB pieces──> Google Drive (one-file upload link from /api/startUpload)
     └──thumbnails──────> drive.google.com (folder is "anyone with the link: viewer")
```

Photo and video bytes go **straight from the guest's phone to Google Drive**. They never pass through your home internet or the tunnel, so big videos are fine.

| Path | What |
|---|---|
| `public/index.html` | the page (album + upload) |
| `server/` | Node server (no npm packages needed): `server.js`, `drive.js` (Drive calls), `google.js` (sign-in), `check-setup.js` |
| `scripts/get-refresh-token.js` | one-time Google sign-in |
| `Dockerfile`, `docker-compose.yml` | runs the server + Cloudflare Tunnel |
| `legacy/` | the old Google Apps Script version, plus `Redirect.html` for the old link |

## Setup (one time)

You need: the home server with Docker, a domain on Cloudflare, and Node 20.12+ on the machine where you do step 2 (or use Docker for it, see below).

1. **Google Cloud project.** Go to <https://console.cloud.google.com>:
   - Create a project (e.g. "Wedding upload"), then **APIs & Services → Library → Google Drive API → Enable**.
   - **OAuth consent screen:** User type **External**, fill in the app name and your email. Then **Publish app** so it's **In production**.
     (In "Testing" mode Google expires the sign-in after 7 days and the site would stop working. You don't need Google's review: when you sign in, you'll click **Advanced → Go to … (unsafe)**, which only means you wrote the app yourself.)
   - **Credentials → Create credentials → OAuth client ID → Desktop app.** Copy the client ID and secret.

2. **Settings and sign-in.**
   ```bash
   cp .env.example .env
   ```
   Fill in `FOLDER_ID` (the part after `folders/` in your Drive folder's URL), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `PUBLIC_ORIGIN` (the address guests will open, e.g. `https://photos.example.com`). Then sign in with the Google account that owns the folder:
   ```bash
   node scripts/get-refresh-token.js
   ```
   Open the link it prints **in a browser on the same machine**, allow access, and paste the `GOOGLE_REFRESH_TOKEN=…` line into `.env`.
   On a headless server, forward the port from your laptop first: `ssh -L 8765:localhost:8765 your-server`.
   Without Node installed: `docker compose run --rm -p 8765:8765 app node scripts/get-refresh-token.js`.

3. **Check.**
   ```bash
   node server/check-setup.js
   ```
   (or `docker compose run --rm app node server/check-setup.js`). You should see three ✅ lines. **This also sets the folder to "Anyone with the link: Viewer"** so the album can show the photos.

4. **Cloudflare Tunnel.** In the Cloudflare dashboard: **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**. Copy the token into `TUNNEL_TOKEN` in `.env`. Under **Public hostname**, add `photos.example.com` (your domain) → service **HTTP** → `app:8080`.

5. **Start.**
   ```bash
   docker compose up -d --build
   ```
   It restarts by itself after a reboot.

6. **Test.** Open the link on your phone using mobile data (not home Wi-Fi), in a private window. Upload one photo and one big video. Check both show up in the Drive folder and in the album. A new video can show 🎬 for a few minutes while Google processes it.

7. **Share.** Make a QR code for the link and post it in your LINE group or print it. To send people straight to the upload page, add `?page=upload`, e.g. `https://photos.example.com/?page=upload`.

## Moving from the old Apps Script link

Keep the old Apps Script site running until the new one works. If the old `script.google.com/…/exec` link is already printed or shared, open the old Apps Script project, replace the contents of `Index` with `legacy/Redirect.html` (set `NEW_URL` in it), and use **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The old link then sends guests to the new site. Otherwise, just archive the old deployment.

## Testing on your computer

```bash
node server/server.js
```
- `http://localhost:8080/?preview` shows the page with fake photos; nothing is sent anywhere.
- For real uploads locally, add it to `PUBLIC_ORIGIN`: `PUBLIC_ORIGIN=https://photos.example.com,http://localhost:8080`.

## Good to know

- **Storage:** uploads count against your Google storage (15 GB free). Check your space at <https://drive.google.com/settings/storage>.
- **Big videos** are fine. The page sends them to Drive in 8 MB pieces and retries if the connection drops. Guests should keep the page open until every file shows ✅.
- **File names** start with the name the guest typed, for example `ป้าแดง - IMG_1234.MOV`.
- **Name buttons** group uploads by the name typed on the upload page. Capital letters and extra spaces don't matter ("mint" = "Mint "), but different spellings ("Mint" / "มิ้นท์") show as separate buttons. Uploads with no name go under **ไม่ระบุชื่อ · No name**. Name buttons refresh about once a minute.
- **Changing the page:** edit `public/index.html`, then `docker compose up -d --build`.
- **Hiding something from the album:** move it to the trash, or into a subfolder inside the upload folder. The album updates within about 30 seconds.
- **Wedding day:** keep the home server plugged in and awake. If it goes down, guests can't open the page, but uploads already in progress keep going straight to Drive.
- **Closing the site:** `docker compose down`, or delete the public hostname in Cloudflare.
- **Privacy:** anyone with the page link can upload *and* view the album, so only share the link with your guests. To make the photos private again, open the folder in Drive → **Share → General access → Restricted**. The album will then show empty tiles.
- **If the album or uploads stop working:** check `docker compose logs app`. "Could not sign in to Google Drive" means the sign-in was revoked or expired (e.g. the consent screen was still in Testing). Run step 2's `get-refresh-token.js` again, update `.env`, and `docker compose up -d`.
