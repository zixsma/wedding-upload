# Ruengrin ♥ Tanakrit: guest album & upload

A small web site for your guests, with two pages:

1. **Album (first page):** everyone's photos and videos, newest first. Tap one to see it full screen, swipe for the next, and tap **Open** to download the original.
   A row of name buttons above the photos (**All · ⭐ Mine · Mint · ป้าแดง …**) shows just one guest's uploads. Tapping the name under a photo in the full-screen view does the same.
2. **Upload:** guests pick photos and videos on their phones, and the files go straight into a folder in your Google Drive.

Guests don't need to sign in. It's free, and Google hosts it.

Files in this folder:

| File | Paste into Apps Script as |
|---|---|
| `Code.gs` | `Code.gs` |
| `Index.html` | an HTML file named **Index** |
| `appsscript.json` | the project manifest |

## Setup (about 10 minutes, one time)

1. **Make the Drive folder.** In Google Drive, create a folder (for example "Wedding photos from guests") and open it.
   The URL looks like `https://drive.google.com/drive/folders/1AbCdEf...`. Copy the part after `folders/`. That's the **folder ID**.

2. **Create the script.** Go to <https://script.google.com>, click **New project**, and rename it "Wedding upload".

3. **Paste the code.**
   - Replace everything in `Code.gs` with this folder's `Code.gs`, then set `FOLDER_ID` to your folder ID.
   - Click **+ → HTML**, name it `Index` (Apps Script adds `.html` itself), and paste in `Index.html`.
   - Click ⚙️ **Project Settings** and tick **Show "appsscript.json" manifest file in editor**. Go back to the editor, open `appsscript.json`, and replace its contents with this folder's `appsscript.json`.
   - Save (⌘S).

4. **Authorize.** Pick `checkSetup` in the function menu at the top and click **Run**.
   Google asks for permission. Choose your account, then **Advanced → Go to Wedding upload (unsafe) → Allow**.
   (The "unsafe" warning only means you wrote the app yourself and Google hasn't reviewed it.)
   The log should show two ✅ lines: where uploads will go, and that the album is on.
   **This step also sets the folder to "Anyone with the link: Viewer"** so the album can show the photos. Guests never see the folder link, but anyone with the page link can view everything in the album.

5. **Publish.** Click **Deploy → New deployment → ⚙️ → Web app**, then set:
   - Execute as: **Me**
   - Who has access: **Anyone**

   Click **Deploy** and copy the **Web app URL** (ends in `/exec`). That's the link for your guests.

6. **Test.** Open the link on your phone in a private/incognito window and upload one photo and one video. Check that both show up in the folder, then tap **See the album** and check that both show up there too. A new video can show 🎬 for a few minutes while Google processes it.

7. **Share.** Make a QR code for the link (or ask Claude to make one) and post it in your LINE group or print it.
   To send people straight to the upload page, add `?page=upload` to the end of the link, for example `https://script.google.com/macros/s/…/exec?page=upload`.

## Good to know

- **Storage:** uploads count against your Google storage (15 GB free). Phone videos are large, so check your space at <https://drive.google.com/settings/storage>.
- **Big videos** are fine. The page sends them to Drive in 8 MB pieces and retries if the connection drops. Guests should keep the page open until every file shows ✅.
- **File names** start with the name the guest typed, for example `ป้าแดง - IMG_1234.MOV`.
- **Name buttons** group uploads by the name typed on the upload page. Capital letters and extra spaces don't matter ("mint" = "Mint "), but different spellings ("Mint" / "มิ้นท์") show as separate buttons. Uploads with no name go under **ไม่ระบุชื่อ · No name**. Name buttons refresh about once a minute. Very long Thai names are trimmed (around 36 letters) in the button only; the file name keeps the full name.
- **Banner:** Google shows a small grey line at the top saying "This application was created by a Google Apps Script user". That's normal and can't be removed.
- **Changing the page later:** edit the files, then use **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The link stays the same.
- **Hiding something from the album:** move it to the trash, or into a subfolder inside the upload folder. The album only shows files sitting directly in the folder. It updates within about 30 seconds.
- **Closing the site:** use **Deploy → Manage deployments → Archive**. That closes both the album and uploads.
- **Privacy:** anyone with the page link can upload *and* view the album, so only share the link with your guests. To make the photos private again, open the folder in Drive → **Share → General access → Restricted**. The album will then show empty tiles.
