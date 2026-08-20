# Trousseau

The shared data contract behind four wedding tools — [Tableaux](https://github.com/JFrusher/Tableaux)
(seating), [Plaque](https://github.com/JFrusher/Plaque) (stationery),
[Cadence](https://github.com/JFrusher/cadence) (timeline) and
[Brigade](https://github.com/JFrusher/Brigade) (crew).

A trousseau is the collection carried into a marriage. A `.trousseau.json` is
the same idea: one file holding the whole wedding, which any of the tools can
read and none of them can damage.

**One owner per slice. Owners publish resolved output. Nobody recomputes.**
Tableaux owns the seating and publishes who sits where; Plaque reads it and
prints the table number on the card. Cadence owns the day and publishes the
clock times it worked out; Brigade reads them and never runs a scheduler. An app
rewrites only its own slice and preserves every other key byte-for-byte,
including keys it has never heard of — which is how a fifth app joins without
anyone releasing anything.

## Install

```sh
npm install @jfrusher/trousseau
```

## Use

```ts
import { emptyTrousseau, mergeSlice, migrate, parse, serialise } from "@jfrusher/trousseau";

// Read a stored document. Never throws away what it does not understand.
const doc = migrate(rawFromStorage);

// Publish your slice. Every other key is copied untouched, including
// slices belonging to apps that do not exist yet.
const next = mergeSlice(rawFromStorage, "day", myResolvedDay);

// The portable file.
const text = serialise(doc);
const back = parse(text);
```

## The rules

1. An app rewrites **only its own slice** and copies every other key
   byte-for-byte, including keys it has never heard of.
2. Unknown keys **inside** a slice an app owns are preserved too.

`mergeSlice` enforces both. It takes raw stored data rather than a parsed
document on purpose: a wrong schema should at worst refuse a read, never destroy
a write.

| Slice | Owner |
| --- | --- |
| `event` | the launcher |
| `guests`, `seating` | Tableaux |
| `day` | Cadence |
| `crew` | Brigade |
| `stationery` | Plaque |

## Design

[The full design](docs/superpowers/specs/2026-08-20-trousseau-design.md), including
why there is no shared UI kit and no monorepo.
