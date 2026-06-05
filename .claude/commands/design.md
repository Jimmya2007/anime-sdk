Read the file at `website/DESIGN.md` in full, then confirm you've internalized the design system before writing any frontend code.

When writing new Astro components or pages:

1. Check that every section uses `.hline` for separation — never margin.
2. Use `.cell` / `.vline` / `.hline` grid primitives instead of card components.
3. No `rounded-*`, no `shadow-*`, no nested containers with their own background.
4. Buttons follow the two patterns in DESIGN.md (white fill or bordered muted).
5. All colours through CSS vars (`--bg`, `--border`, `--muted`, `--accent`) — never hardcoded.
6. Typography sizes and weights from the table in DESIGN.md.
7. For side-label layouts (like Providers or Contribute), use the 280px fixed left pane + flex-1 right pattern.

After reading, summarize the three most relevant constraints for the specific UI you are about to build, then proceed.
