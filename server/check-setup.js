// Run once after filling in .env: checks the Google sign-in and the folder, and sets the
// folder to "Anyone with the link: Viewer" so the album can show the photos.
//
//   node server/check-setup.js

try { process.loadEnvFile(); } catch { /* settings from environment */ }

const { checkSetup } = await import('./drive.js');

try {
  const folder = await checkSetup();
  console.log(`✅ Uploads will go to: "${folder.name}"  ${folder.webViewLink}`);
  console.log('✅ Album is on: anyone with the page link can view the photos & videos in this folder.');
  console.log(`✅ Uploads allowed from: ${process.env.PUBLIC_ORIGIN}`);
} catch (e) {
  console.error('❌ ' + e.message);
  process.exit(1);
}
