# The wedding data, and where it lives

Trousseau holds the canonical wedding. The four apps hold working copies.

Git carries the schemas, the scripts and the **pointers**. DVC carries the data
itself, to a private OneDrive folder. Nothing with a guest's name on it has ever
reached a public repo, and this arrangement is what keeps that true.

```
data/
  wedding.trousseau.json        <- canonical. DVC-tracked, git-ignored.
  wedding.trousseau.json.dvc    <- the pointer. 4 lines of md5, committed.
  exports/                      <- derived PDFs and CSVs. DVC-tracked, git-ignored.
  exports.dvc                   <- the pointer. Committed.
  .gitignore                    <- written by DVC. Committed.
```

## Setting up a new device

```sh
git clone https://github.com/JFrusher/Trousseau && cd Trousseau
npm install

# The remote URL is per-device and deliberately not committed — it names a path
# on your machine, and this repo is public.
python -m dvc remote add --local -d onedrive "<path to your OneDrive>/wedding-dvc"

git config core.hooksPath .githooks   # validation, and data before pointers
npm run data:pull
```

`dvc` is a Python package. `python -m dvc` is used everywhere in place of the
`dvc` binary so nothing depends on the Scripts directory being on PATH. Install
it with `pip install dvc`.

If the OneDrive folder shows as online-only, right-click it and choose **Always
keep on this device**. DVC reads it as a plain directory and a placeholder file
is not the data.

## Seeding from the machine that has the real files

The first push decides what everyone else pulls, so it has to come from the
machine holding the working documents — not whichever machine set DVC up.

On the machine with the real files, after the setup above:

```sh
npm run data:pack      # reads the four apps' working copies
npm run data:validate  # fix whatever it names before going further
npm run data:push
git add data/*.dvc && git commit -m "seed the wedding data" && git push
```

Everywhere else:

```sh
git pull && npm run data:pull
```

`data:pack` reads its sources by relative path from sibling repos. If they are
not all cloned side by side, name the files directly instead — `bundle.mjs`
takes any paths:

```sh
node scripts/bundle.mjs pack ~/Desktop/state.json ~/Desktop/day.cadence.json \
  -o data/wedding.trousseau.json
```

`dvc pull` only ever writes `data/`. The apps' own working copies are not
DVC-tracked and are never touched by it.

## The daily loop

| Command | What it does |
|---|---|
| `npm run data:pull` | Fetch the current data for the checked-out commit |
| `npm run data:pack` | Rebuild the canonical file from the four apps' working copies |
| `npm run data:unpack` | Explode the canonical file back into per-app files in `unpacked/` |
| `npm run data:validate` | Every cross-slice invariant. Exit 1 on any error |
| `npm run data:status` | What has changed since the last `data:push` |
| `npm run data:push` | Validate, re-hash, upload. Refuses if validation fails |

Editing on device A, reading on device B:

```sh
# A
npm run data:pack && npm run data:push
git add data/*.dvc && git commit -m "seating: move the Kellys to table 6" && git push

# B
git pull            # post-checkout brings the data across
npm run data:unpack # then open each file in its own app
```

## What the validator checks

`scripts/validate-wedding.mjs`. The zod schema in `src/` validates the envelope
and nothing more — slice interiors belong to the owning app, on purpose. These
are the invariants that span two slices, which is exactly the set no single app
can see.

**Errors** (exit 1, commit blocked):

- Two slices claiming different wedding dates
- One seat holding two people
- A table holding a guest who does not exist
- The same guest seated twice at one table
- A table over its own capacity
- A guest and their table disagreeing about whether they sit there
- A day block in a lane that does not exist

**Warnings** (printed, exit 0):

- Confirmed guests with no table
- Confirmed guests with no dietary answer at all
- Lanes with nothing in them

`assignedGuestIds` is positional in seat mode and padded with `null` for empty
seats. Filter before counting, or every unfilled seat reads as a missing guest.

## Milestones

A git tag pins the code, the schema and the exact data hash together, because
the `.dvc` pointer is a committed file like any other. No separate mechanism.

```sh
npm run data:push
git add data/*.dvc && git commit -m "the seating we sent to the printer"
git tag -a print-run-2026-05-01 -m "Place cards and floor plan as sent"
git push --follow-tags
```

Coming back to one, months later:

```sh
git checkout print-run-2026-05-01   # post-checkout restores the matching data
npm run data:unpack
```

## Rules

- **The apps never write `data/`.** They write their own working copies;
  `data:pack` collects them. One writer means no merge conflicts on a 100 KB
  JSON file.
- **`data:pack` reads sibling repos by relative path.** It assumes the layout in
  `Wedding.code-workspace`. Move a repo and the paths in `package.json` move.
- **A conflict is reported, never resolved.** `bundle.mjs` keeps the first claim
  and prints a note; the validator turns that note into a failed build. Two
  dates for one wedding is a decision, and no script gets to make it.
