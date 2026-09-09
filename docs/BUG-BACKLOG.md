# Bug & Quirk Backlog

Append new entries under **Open** as you hit them — doesn't need to be tidy,
just enough for a fresh session to find the problem. Run `/work-backlog` to
have Claude work through this list: investigate root cause, ask if the
repro is unclear, fix, and move each entry down to **Resolved**.

## How to add an entry

Copy this into Open, fill in what you know:

```
### <short title>
- **Reported:** YYYY-MM-DD
- **App/area:** Cadence | Tableaux | Brigade | Ensemble | Plaque | shell/header | accounts | other
- **What happened:** <what you saw>
- **Expected:** <what should've happened, if obvious>
- **Repro:** <steps, or "not sure — happened while doing X">
- **Severity:** blocks me | annoying | cosmetic
```

Only "What happened" is required — leave the rest blank if you don't know it.

---

## Open

*(nothing yet)*

---

## Sample (for reference — see the matching entry under Resolved for how this
one played out; both stay here permanently as a worked example, not a real
open bug)

### Adjusting table side count removes a seated guest even when a free seat exists
- **Reported:** 2026-09-09
- **App/area:** Tableaux
- **What happened:** Changing a table's per-side seat count sometimes removes a
  seat that has a guest assigned, even when that side has an empty seat it
  could have removed instead.
- **Expected:** Shrinking a side should always prefer removing an empty seat on
  that side; a seated guest should only be bumped when every seat on that side
  is occupied.
- **Repro:** Not sure of exact steps — noticed while adjusting side counts on a
  table that already had some guests seated and some empty seats.
- **Severity:** annoying

---

## Resolved

*(fixed entries move here, newest first, with the commit that fixed them)*

### [SAMPLE] Adjusting table side count removes a seated guest even when a free seat exists
- **Reported:** 2026-09-09
- **App/area:** Tableaux
- **What happened:** Changing a table's per-side seat count sometimes removed
  a seat that had a guest assigned, even when that side had an empty seat it
  could have removed instead.
- **Root cause:** `setPerSideSeats` (`suite/apps/tableaux/store/actions.js`)
  truncated `assignedGuestIds` by raw flat-array index against the *new total*
  capacity, with no idea which side actually changed. Seats are laid out
  `top → bottom → left → right`, so shrinking one side could silently evict a
  guest sitting on a completely different, untouched side, while the side
  that actually shrank sailed through untouched even when it had a free seat
  to give up.
- **Fix:** `41a00d4` — re-slice the array side by side instead of truncating
  the flat array: a growing side keeps its guests and gets empty seats
  appended; a shrinking side drops its own empty seats first, and only bumps
  a guest to overflow once every remaining seat on that specific side is
  already taken. New function `remapSeatsForSides` in
  `suite/apps/tableaux/utils/seatPositions.js`, covered by a new regression
  test in `suite/apps/tableaux/store/tableActions.test.js`.
- **This is the sample entry** — kept here permanently (never delete it) so
  future entries have a real worked example of what "Root cause" and "Fix"
  should look like once `/work-backlog` closes something out.
