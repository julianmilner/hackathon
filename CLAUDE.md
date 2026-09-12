# Team instructions for Claude

This is a hackathon project. Optimise for a compelling, reliable end-to-end demo—not a production-complete system.

## Before you change things

1. Read `README.md`.
2. Read the relevant file(s) in `docs/` before changing product direction, UX, or architecture.
3. Inspect the existing code and conventions; do not replace working setup without a reason.

## Working rules

- Prefer the smallest implementation that proves the core user value.
- Keep changes focused; avoid unrelated refactors and dependencies.
- Preserve the primary demo path. Call out any risk to it.
- State assumptions when requirements are incomplete, then choose the most reversible reasonable option.
- Never invent API keys, user data, integrations, or test results.
- Reuse existing components and patterns before adding new ones.

## Source of truth

- `docs/vision.md` holds the agreed product direction.
- `docs/backlog.md` holds priorities and uncommitted ideas.
- `docs/decisions.md` records decisions that affect future work.
- `docs/design-system.md` holds UI and product interaction rules.
- `docs/architecture.md` holds technical boundaries and major choices.
- `docs/demo.md` holds the presentation and happy-path demo.

When your change makes one of these documents inaccurate, update it in the same change. Add a dated entry to `docs/decisions.md` for a material trade-off.

## Definition of done

- The intended user flow works locally.
- Relevant checks have been run, or the reason they could not be run is stated.
- The happy-path demo still works.
- Documentation is updated when the change affects shared understanding.
