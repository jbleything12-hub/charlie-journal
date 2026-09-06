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

## Building an entry (as of this update)

Food is now logged as one time-stamped entry that can hold several things at
once — tap "Salmon LID," add 1 cup, tap "Fish Oil," add 3 pumps, and it all
saves together as a single 10:45am entry instead of two separate rows.

- **Foods and Supplements** each get their own chip row on the Journal tab.
  Supplements are managed on the Foods tab, same pattern as foods — name plus
  an optional calories-per-pump (handy for something like a fish oil pump
  bottle that lists kcal per pump on the label).
- **"Something he shouldn't have eaten"** logs an off-plan item with just a
  time and a free-text description — no calorie or nutrient math, since
  there's nothing to calculate for a sock or a piece of trash. It can be
  added on its own or alongside a normal meal in the same entry.
- Editing a saved entry reopens the same builder, pre-filled, so you can add,
  remove, or adjust before saving again.
- Old entries logged before this update still display correctly — they're
  read and grouped into this shape automatically, nothing is lost.

**One-time setup in Supabase** for supplements — run this once in the SQL
Editor:

```sql
create table supplements (
  id text primary key,
  user_id uuid references auth.users not null default auth.uid(),
  name text not null,
  cals_per_pump numeric,
  updated_at timestamptz default now()
);
alter table supplements enable row level security;
create policy "own supplements" on supplements for all using (auth.uid() = user_id);
```

## Nutrient tracking (optional, per food)

You can now log a food's calories-per-kg, protein %, fat %, and fiber % (all
from the "Calorie Content" and "Guaranteed Analysis" sections of the bag) via
"+ Add nutrition info" on the Foods tab. None of it is required — a food
without this info still works exactly as it always has.

When it's filled in, the app estimates grams of protein/fat/fiber per log
entry, totals them on the Journal tab and in Reports, and includes them in
the Excel export. These are estimates from guaranteed-analysis minimums/
maximums, not lab measurements — the app labels them "est." everywhere they
appear for that reason.

**One-time setup in Supabase:** open the SQL Editor and run this once, so the
`foods` table has room for the new fields:

```sql
alter table foods
  add column if not exists kcal_per_kg numeric,
  add column if not exists protein_pct numeric,
  add column if not exists fat_pct numeric,
  add column if not exists fiber_pct numeric,
  add column if not exists grams_per_cup numeric;
```

## Editing entries

Every food log, bathroom log, and food in your back-end list has a pencil
icon next to it — tap it to edit that entry in place, or the X to delete it.
Edits update the same record everywhere (including in Supabase), rather than
creating a duplicate.

## Notes

- To make design or feature changes later, edit `app.js` (logic) and `style.css`
  (look and feel), commit, and GitHub Pages will update automatically.
