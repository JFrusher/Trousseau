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

Nothing is built yet. Start with the
[design](docs/superpowers/specs/2026-08-20-trousseau-design.md).
