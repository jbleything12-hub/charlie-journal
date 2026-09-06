# Charlie's Journal

A food and bathroom log for Charlie — installable on your phone's home screen,
works offline, exports Excel reports, and backs up automatically to Supabase.

## Cloud sync (already wired up)

`config.js` already has your Supabase project URL and anon key in it — nothing
to fill in. The first time you open the app, you'll see a one-time sign-in
screen (the email/password you created in Supabase's Authentication → Users).
After that, it stays signed in and syncs silently in the background:

- Every food, food log, and bathroom log you add is pushed to Supabase right
  after it's saved locally.
- If you're offline when that happens, the change is queued and retried
  automatically once you're back online.
- On each app open, it pulls anything from Supabase you don't have locally yet
  (useful if you ever log from a second device) and merges it in.

The app still works fully offline — sync just happens quietly whenever
there's a connection. There's a **Sign out** button on the Foods tab if you
ever need to switch accounts or hand the phone to someone else.

## 1. Put it on GitHub

1. Create a new repository on GitHub (e.g. `charlie-journal`). It can be public or private.
2. Upload every file in this folder to the repo, **keeping the folder structure**:
   - `index.html`
   - `style.css`
   - `app.js`
   - `sync.js`
   - `config.js`
   - `manifest.json`
   - `service-worker.js`
   - `icons/icon-32.png`, `icons/icon-180.png`, `icons/icon-192.png`, `icons/icon-512.png`
   - Easiest way: on the repo page, click **Add file → Upload files**, drag the whole
     folder in, and commit.

## 2. Turn on GitHub Pages

1. In the repo, go to **Settings → Pages**.
2. Under "Build and deployment", set **Source** to `Deploy from a branch`.
3. Pick the `main` branch and `/ (root)` folder, then **Save**.
4. GitHub will give you a URL after a minute or two, usually:
   `https://<your-username>.github.io/charlie-journal/`

## 3. Add it to your phone's home screen

**iPhone (Safari):**
1. Open the GitHub Pages URL in Safari.
2. Tap the **Share** icon (square with an arrow).
3. Tap **Add to Home Screen**, then **Add**.

**Android (Chrome):**
1. Open the GitHub Pages URL in Chrome.
2. Tap the **⋮** menu.
3. Tap **Add to Home screen** (or **Install app** if Chrome offers it directly).

Once added, it opens full-screen with Charlie's paw icon, just like a regular app —
no browser bar, and it works offline after the first load.

## Don't lose your data

With cloud sync on, Supabase is your real safety net — clearing this phone's
browser data or losing the phone no longer means losing the log, since
everything's already backed up there. Sign in with the same email and
password on a new device (or after reinstalling) and it pulls everything
back down.

The **Export to Excel** button on the Reports tab is for sharing readable
data with your vet — a snapshot, not a way to restore the app itself.

## Editing entries

Every food log, bathroom log, and food in your back-end list has a pencil
icon next to it — tap it to edit that entry in place, or the X to delete it.
Edits update the same record everywhere (including in Supabase), rather than
creating a duplicate.

## Notes

- To make design or feature changes later, edit `app.js` (logic) and `style.css`
  (look and feel), commit, and GitHub Pages will update automatically.
