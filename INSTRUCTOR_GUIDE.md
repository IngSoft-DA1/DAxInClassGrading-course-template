# Instructor Guide

How to set up and use DAxInClassGrading for your course. **There is nothing
to download, install, or run.** Every step below is either a page on
github.com, or a normal webpage you visit in your browser like any other
website (Chrome, Firefox, Safari — whichever you use day to day).

## First-time setup (one instructor, once per course)

### 1. Create your course repository

1. Open the course template:
   [github.com/IngSoft-DA1/DAxInClassGrading-course-template/generate](https://github.com/IngSoft-DA1/DAxInClassGrading-course-template/generate).
2. Click **"Create repository from template"** (this page skips straight to
   step 2 below — no separate "Use this template" click needed).
3. **Owner**: pick the GitHub organization for your course. You need to be
   an Owner of that organization.
4. **Repository name**: whatever you'd like — there's no required naming
   pattern.
5. **Visibility**: **Private**. This is important — it's what keeps your
   course repo restricted to instructors you explicitly add.
6. Click **Create repository**.

### 2. Turn on GitHub Pages for your new repository

This is a **required, one-time step** — GitHub won't let a repository publish
a website until you turn this on for it (this is a GitHub restriction, not
something this app can skip or automate).

1. In your new repository, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.

That's it — no need to configure anything else on this screen.

### 3. Wait about a minute

Creating the repository automatically kicked off a one-time deploy that
publishes your course's own copy of the app — but it needed step 2 done
first, or it fails. If you did step 2 *after* the repository was created
(rather than the instant you saw the option), go to the **Actions** tab,
open the failed "Deploy course app to Pages" run, and click **Re-run jobs**.
Once it shows a green checkmark, you're ready.

### 4. Find your course's app URL

Your app is now live — as a normal webpage, not a file — at:

```
https://<your-organization>.github.io/<your-repository-name>/
```

For example, if your organization is `IngSoft-DA1` and you named the
repository `da1-fall2026`, the URL is
`https://ingsoft-da1.github.io/da1-fall2026/`. Type or paste that into your
browser's address bar and press Enter, the same way you'd visit any website.
**Bookmark it** — it's the one link you'll use all semester; you won't need
to come back to GitHub's "create repository" flow again.

### 5. Create a Personal Access Token

The app needs a GitHub Personal Access Token (PAT) to read and write your
course's data on your behalf. It uses a **fine-grained** token, scoped to
just this course repo (and its org's membership) — not a classic token with
account-wide `repo`/`admin:org` scopes.

1. In your browser's address bar, go to your course's app URL from step 4
   (the same way you'd visit any website — nothing to open or run locally).
   You'll land on the **Connect** screen.
2. Click **"Create a token scoped to this course"**. It opens GitHub's
   token-creation page pre-filled with this course's org and the exact
   permissions the app needs (repo contents, repo collaborators, org
   membership) and a 90-day expiration — adjust the expiration if you'd
   like something different.
3. Under **"Repository access"**, choose **"Only select repositories"** and
   pick this course's repo (GitHub can't pre-fill this part). If you're
   teaching more than one section under the same org and want one token to
   work for all of them, select all of those course repos here too.
4. Click **Generate token**, then **copy it** — GitHub only shows it once.
   Treat it like a password; don't share it or commit it anywhere.

   > **Note:** if your org restricts or requires approval for fine-grained
   > tokens, GitHub will tell you on this page — see
   > [Setting a personal access token policy for your organization](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization)
   > and ask an org owner to approve or allow it.
   >

### 6. Paste your token and configure your course

1. Back on the Connect screen from step 5, paste your token and click
   **Connect**.
2. Since this is a brand-new course repo, you'll land on a **"Configure
   this course"** form. Fill in:
   - **Course Session ID** — a short identifier for this course/semester
     (e.g. `M5ADA1-ID`). This is shown at the top of every page from now on.
   - **Theory / Lab participation max** — the maximum points a student can
     earn in each oral-participation category (defaults 2/2).
   - **Random student picker draw spacing** — how many weeks apart the
     picker tries to spread a student's Theory and Lab draws (default 12).
   - **Written activity max** — the maximum score for the written activity,
     shared by its official date and the make-up sitting (default 6).
   - **Bonus max** — the maximum bonus points a student can accumulate
     (default 3).
   - There's no way to re-open this form later — double-check the values
     before saving. The in-class performance cap (default 10) is always the
     sum of Theory + Lab + Written Activity max, so it's never configured
     separately.
3. Click **Save configuration**. You're now on the Course Home screen.

That's it — the course is set up. Reopening the same URL later goes
straight to Course Home; you won't see the configure form again.

## Security precautions

This app is a static webpage with no server of its own — your Personal
Access Token lives in this browser's storage and is sent straight to
GitHub's API. A few habits keep that safe:

- **When creating the token**, keep "Only select repositories" scoped to
  just the course repo(s) you're actually using — never switch it to "All
  repositories" — and keep a real expiration (the link pre-fills 90 days)
  rather than "No expiration."
- **Treat the token like a password.** Never paste it anywhere but the
  Connect screen, and never commit it or share it — each instructor should
  generate their own via step 5 above, not reuse someone else's.
- **Avoid signing in on shared or public computers.** If you must, click
  **Sign out** (see below) the moment you're done — that's the only thing
  that removes the token from that browser; it does *not* clear itself when
  you just close the tab or the browser.
- **Only add instructors/collaborators you trust.** "Adding other
  instructors" below grants that person `push` access to the repository.
- **If a device is lost or stolen, or you suspect the token leaked**, revoke
  it immediately from GitHub → Settings → Developer settings → Fine-grained
  tokens, rather than waiting for it to expire on its own.
- **When a token expires**, generate a new one the same way (step 5) instead
  of widening its scope or expiration "for convenience."
- **Periodically review** the repository list attached to your token on
  GitHub, and prune any course repos you no longer teach.

## Adding other instructors

On Course Home, under **Instructors**, enter a colleague's GitHub handle and
click **Add instructor**. They'll be added as a repository collaborator,
which is what gives them access — no separate account or invite process in
the app itself. They may need to accept a GitHub invitation email first.

Once added, they use the app exactly like you do: open the same bookmarked
URL, sign in with **their own** Personal Access Token (step 5 above), done.
They never need to create anything, or touch Settings → Pages — that's a
once-per-repository step you already did.

## Updating your course repo's app code (optional, advanced)

Each course repo is a standalone snapshot of the app from the moment it was
created — a fix or new feature that ships later doesn't reach existing
course repos automatically. If your maintainer tells you a fix is available
and worth pulling in, there's a small script that does this for you:
`update-from-template.sh` (macOS/Linux) or `update-from-template.ps1`
(Windows, PowerShell 7+).

This is the one part of using DAxInClassGrading that needs a command line
and `git` installed — everything else in this guide happens in the browser.
It's entirely optional: if you never run it, your course repo just keeps
working exactly as it does today.

Whichever way you get and run it below, the script only ever touches
`index.html`, `assets/`, and `.github/workflows/deploy-pages.yml` — it never
touches `config/course.json`, `students/`, `grades/`, or `photos/`, so your
roster and grades are never at risk. It also refuses to run if the folder
doesn't actually look like a course-repo clone (e.g. this dev repo or the
template repo itself), as a safety check against running it in the wrong
place. Which of the two cases below applies depends on whether you already
have a local clone of your course repo:

### Case 1: You have a local clone

`cd` into it, then check if it already has the script:
`ls scripts/update-from-template.sh` (or just browse your repo on GitHub for
that path).

- **If it's there** (your repo was generated after this script was added to
  the template), run it in place — no flags needed, it detects the repo
  you're sitting in:

  ```sh
  ./scripts/update-from-template.sh
  ```

  Windows (PowerShell 7+):

  ```powershell
  .\scripts\update-from-template.ps1
  ```
- **If it's not there** (an older repo, created before this script existed —
  the common case today; GitHub's "generate from template" only copies files
  that existed at that moment, and running the script later doesn't
  retroactively add itself to your repo either), download it once from the
  **template repo** instead — this copy isn't tied to any particular course,
  so the same download works for every course repo you maintain. It doesn't
  need to live inside your clone; save it anywhere, then run it *from inside
  your clone's directory*, still with no `--repo`/`-Repo` flag:

  ```sh
  curl -O https://raw.githubusercontent.com/IngSoft-DA1/DAxInClassGrading-course-template/main/scripts/update-from-template.sh
  chmod +x update-from-template.sh
  cd /path/to/your/course-repo-clone
  /path/to/update-from-template.sh
  ```

  (No `curl`? Open that URL in your browser and save the page instead.
  Windows: same idea with `.../scripts/update-from-template.ps1`.)

### Case 2: You don't have a local clone

Download the script the same way as above (from your own repo if it has it,
otherwise from the template repo), then run it with `--repo`/`-Repo` pointed
at your course repo — this is the *only* case that needs this flag, since
it's what tells the script to clone the destination itself rather than use
the directory you're already in:

```sh
./update-from-template.sh --repo <your-org>/<your-repo-name>
```

```powershell
.\update-from-template.ps1 -Repo <your-org>/<your-repo-name>
```

### Running it

Either case above ends the same way:

1. It fetches the current app code from the published course template and
   prints a "Changes to commit" summary. Type `y` to commit and push, or
   anything else to abort — nothing is pushed either way until you confirm.
   (If you abort, the files on disk are still changed; run `git checkout -- .` to discard them.)
2. To skip the confirmation prompt, add `-y` (bash) or `-Yes` (PowerShell).
   To see what would change without touching anything, add `--dry-run`
   (bash) or `-DryRun` (PowerShell) instead.
3. Add `--dir PATH` (bash) / `-Dir PATH` (PowerShell) alongside `--repo` if
   you'd like it to clone into a folder you choose and keep, instead of a
   throwaway temporary one.
4. **After it pushes, wait for the site to actually rebuild before checking
   it.** The push alone doesn't update your live app — it just triggers the
   same "Deploy course app to Pages" process from first-time setup (step 3
   above) to run again automatically. Go to your course repo's **Actions**
   tab on github.com and watch for a new run named "Deploy course app to
   Pages" at the top of the list; it typically takes under a minute. Only
   once it shows a green checkmark is your bookmarked app URL actually
   serving the update — reloading it before that finishes will still show
   the old version, which can look like the update didn't work when it's
   really just still deploying. If the run shows a red ✗ instead, see
   Troubleshooting below. And once it's green, if the app *still* looks
   unchanged, that's almost always your browser's cache, not a failed
   update — see the hard-refresh tip in Troubleshooting.

5. **Reload every open tab of the app afterwards, and don't mix app
   versions on one course.** Newer versions add columns to your grade files
   (for example the Pending marker in `grades/participation.csv`) — your
   existing data needs no conversion and keeps its meaning, the new columns
   are simply added the next time the updated app saves. But an older
   version of the app (a tab you left open before updating, or a cached
   page) that saves afterwards doesn't know those columns and drops them:
   any Pending entries would revert to "not recorded" (never to a 0) and
   you'd have to mark them Pending again.

Run the script with `--help` (bash) or read the comment block at the top of
the `.ps1` file (Windows) for the full list of advanced flags.

## What's available right now

- **Configure a course** (session ID, Theory/Lab/Written Activity/Bonus
  maximums, picker draw spacing) and **add other instructors**.
- **Roster**: view, add, edit, remove, and import students from CSV, and
  register them in the GitHub organization (individually or in bulk).
  GitHub Handle can be left blank for a student who doesn't have a GitHub
  account — they're still tracked and graded by Student ID, they just can't
  be registered in the org or given repo access.
- **Student Photos**: a separate screen (not part of the roster) for
  bulk-adding photos and manually pairing each one with a student — this is
  purely to help you recognize and remember students; it's never auto-
  matched and doesn't affect grading. Includes a gallery of every student's
  photo for quick review, with click-to-enlarge, and a **Delete photo**
  button in the enlarged view (with a confirmation step) to remove a
  student's saved photo.
- **Participation (Theory/Lab)**: tap-to-record during class — searchable
  roster, a preset Absent/Pending/0/1/2 per category, saves immediately.
  Tapping a different preset later corrects it (Absent included — it's a
  distinct marker, not just a 0). **Pending** is for a student who did
  participate but whom you want to grade later: it records *no grade* (not a
  0), so forgetting it never turns into a 0 — the Grades view and the
  exported CSV mark it **p** (and an absence **a**; a key under the table and
  at the end of the CSV explains both), the total counts only the points
  given, and you're asked to confirm before exporting while any is pending.
  **Download PDF** opens your browser's print dialog — choose "Save as PDF"
  as the destination (nothing is saved to the repo). Tick **Pending only** to list everyone still waiting for
  a grade in the selected category, and grade them by tapping 0/1/2 (or
  Absent); the entry keeps the meeting date it was first recorded for. A
  Pending student counts as already called on, so the picker won't offer
  them again. Bonus has no Pending option. A read-only History view shows every score and
  correction, grouped by student. A **Pick a Student** tool draws randomly
  from whichever students don't yet have a score in the category currently
  being taught, without ever showing a grade on screen. Set **How many
  students** to draw several at once (default 1, at most the number still
  eligible): the picker spins once per student and lists them in order, never
  repeating a student within the same draw.
- **Written Activity**: a single score per student, recorded against
  whichever sitting (official or make-up) produced it. Once a student has a
  score for one sitting, the other becomes unavailable for them — the
  make-up sitting exists only to recover points for a student who missed
  the official one entirely, so switching sittings means clearing the entry
  first and recording it fresh, not just changing a dropdown.
- **Bonus**: tap-to-award during class (a running total and remaining
  headroom under the in-class-performance cap per student), a History view
  to edit or clear individual awards, and a Points-by-Date grid showing
  where each student's bonus came from.
- **Grades**: a consolidated view of every student's Theory, Lab, Written
  Activity, and Bonus points against the derived cap, with a CSV export
  (downloads to your browser and also commits a snapshot to the repo).

## Troubleshooting

- **"That token was rejected by GitHub"** — double-check you copied the
  whole token, and that it hasn't expired. Generate a new one (step 5) if
  needed.
- **"Could not open repository" / "config/course.json not found"** — check
  that your app URL matches the repository you created, and that your GitHub
  account (via your PAT) actually has access to it. If you were added by
  someone else, make sure you've accepted the collaborator invite.
- **The app URL shows a 404 / isn't loading, or the "Deploy course app to
  Pages" run in the Actions tab has a red ✗** — almost always means step 2
  (Settings → Pages → Source → GitHub Actions) hasn't been done yet, or was
  done *after* the repository's first deploy already ran and failed. Do/redo
  step 2, then go to the Actions tab, open the failed run, and click
  **Re-run jobs**.
- **The "Deploy course app to Pages" run shows a green checkmark, but the
  app still looks unchanged** — a very common trap: your browser cached the
  old `index.html`/`assets/` files and just isn't re-fetching them from
  GitHub Pages. Do a hard refresh (`Ctrl+F5` or `Ctrl+Shift+R` on
  Windows/Linux, `Cmd+Shift+R` on Mac), or open the app URL in a private/
  incognito window, before assuming the update itself failed.
- **Signing out** — click **Sign out** in the header to clear your token
  from this browser (useful on a shared computer, or to switch to a
  different token).
