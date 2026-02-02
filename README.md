# Mokum Comment Filter

Browser extension to hide comments from selected users or display names on mokum.place.

## Install without a store

### Chrome / Chromium (unpacked)
1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `extension/` folder.

To update after changes: click **Reload** on the extension card.

### Firefox (temporary add-on)
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select `extension-firefox/manifest.json`.

To update after changes: click **Reload** in the debugging page.

## Install from local zip
- Chrome Web Store upload: `extension.zip`
- Firefox Add-ons upload: `extension-firefox.zip`

Zips are rebuilt as part of release steps and are not tracked in git.

## Publish to Chrome Web Store (GitHub Actions)

This repo includes `.github/workflows/publish-chrome-webstore.yml` which can upload
and optionally publish the Chrome build via the Chrome Web Store API.

Required GitHub Secrets:
- `CWS_EXTENSION_ID` (your extension ID)
- `CWS_CLIENT_ID` (OAuth client ID)
- `CWS_CLIENT_SECRET` (OAuth client secret)
- `CWS_REFRESH_TOKEN` (OAuth refresh token)

Generate `CWS_REFRESH_TOKEN`:

1) Export your client credentials in a shell:

```bash
export CWS_CLIENT_ID="YOUR_CLIENT_ID"
export CWS_CLIENT_SECRET="YOUR_CLIENT_SECRET"
```

2) Run the helper script:

```bash
node scripts/get-cws-refresh-token.js
```

3) Open the printed URL in your browser, approve access, and the script will print
the `CWS_REFRESH_TOKEN`.

4) Add all secrets to GitHub:
Settings → Secrets and variables → Actions → New repository secret.

Run the workflow:
- Manual: GitHub Actions → “Publish to Chrome Web Store” → Run workflow (set `publish=true` to publish).
- Automatic: create a GitHub Release; the workflow will upload the latest zip.
