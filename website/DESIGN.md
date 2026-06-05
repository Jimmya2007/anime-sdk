# ani-sdk Website Design System

## Philosophy

Flat, grid-based, monochromatic. Structure comes from single-pixel borders, not from shadows, elevation, or rounded corners. Every visual region is a cell in a grid — never a floating card. Nesting is avoided: sections sit at a single layer, not stacked inside containers inside wrappers.

## Tokens

Defined in `src/styles/base.css` as CSS custom properties:

```css
--bg: #111113 /* page and frame background */ --border: rgba(255, 255, 255, 0.08)
  /* all divider lines */ --muted: #6b7280 /* secondary text */ --accent: #8b5cf6
  /* purple — links, labels, icons */;
```

**Never hardcode colors.** Always use these vars so light-mode or theme changes propagate.

## Layout

### `.frame`

The single centred container (`max-width: 1100px`). The entire page lives inside one `.frame`. There is only ever **one** `.frame` per page.

```html
<div class="frame">
  <nav />
  <!-- sections -->
  <footer />
</div>
```

### `.hline`

A `border-top: 1px solid var(--border)` that separates sections. Every top-level section starts with `.hline` on the root element. This is how vertical rhythm is created — not margin or padding.

### `.vline`

A `border-right: 1px solid var(--border)` used to divide columns inside a row.

### `.cell`

Pre-padded cell for grid layouts (`padding: 36px 40px`, plus bottom and right borders). Use `.no-right` and `.no-bottom` modifier classes to remove the trailing borders on last items.

```html
<div class="hline grid grid-cols-2">
  <div class="cell">...</div>
  <div class="cell no-right">...</div>
</div>
```

## Sections

Every section follows one of two patterns:

### Header + body

```html
<section id="foo" class="hline">
  <!-- hline separates from above -->
  <div class="px-10 py-8">
    <!-- section header -->
    <h2>Title.</h2>
    <p style="color: var(--muted);">Subtitle.</p>
  </div>
  <div class="hline">
    <!-- hline between header and body -->
    <!-- content rows or grid -->
  </div>
</section>
```

### Side-label + row list (used in Providers, Contribute)

```html
<section class="hline">
  <div class="flex">
    <div
      style="width:280px; flex-shrink:0; border-right:1px solid var(--border);"
      class="px-10 py-8"
    >
      <h2>Label.</h2>
      <p style="color:var(--muted);">...</p>
    </div>
    <div class="flex-1">
      <!-- rows separated by border-top: 1px solid var(--border) -->
    </div>
  </div>
</section>
```

## Typography

| Use                | Class / style                          |
| ------------------ | -------------------------------------- |
| Section headings   | `text-[28px] font-bold tracking-tight` |
| Page headings (h1) | `text-[32px] font-bold tracking-tight` |
| Body / subtitles   | `text-[14px]` + `color: var(--muted)`  |
| Small body         | `text-[13px]` + `color: var(--muted)`  |
| Row labels         | `text-[13.5px] font-semibold`          |
| Monospace          | `font-mono text-[12px] text-zinc-300`  |

Fonts: **Inter** (UI) and **JetBrains Mono** (code) — loaded from Google Fonts in `Layout.astro`.

## Components

### `.label`

Small eyebrow text above section headings.

```html
<div class="label mb-3">SECTION NAME</div>
```

→ 10.5px, 700 weight, 0.1em letter-spacing, accent color.

### `.badge`

Flat pill with no border-radius. Use colour variants for meaning:

```html
<span class="badge badge-ok">sub</span>
<!-- green -->
<span class="badge badge-muted">dub</span>
<!-- blue -->
<span class="badge badge-warn">raw</span>
<!-- orange -->
<span class="badge" style="background:#6d28d9;color:#ede9fe">GraphQL</span>
```

### Inline code

```html
<code class="bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11.5px]">DOMParser</code>
```

### Code blocks (`<pre>`)

Hand-authored HTML with syntax-highlight classes, not a highlighting library:

```
.kw   → keywords (#c792ea)
.str  → strings  (#c3e88d)
.fn   → functions (#82aaff)
.typ  → types    (#ffcb6b)
.num  → numbers  (#f78c6c)
.prop → props    (#89ddff)
.cm   → comments (#546e7a, italic)
.pun  → punctuation (#89ddff)
```

### CTAs / buttons

Primary (white fill):

```html
<a
  class="bg-white px-4 py-1.5 text-[12.5px] font-semibold text-black transition-colors hover:bg-zinc-100"
>
  Get Started
</a>
```

Secondary (bordered):

```html
<a
  class="px-3 py-1.5 text-[12px] font-semibold transition-colors hover:text-white"
  style="color:var(--muted); border:1px solid var(--border);"
>
  View on GitHub ↗
</a>
```

**No rounded corners on buttons.**

## Background

The dot-grid is on `<body>` via CSS. The `.frame` has `background-color: var(--bg)` to mask it inside the frame. Use `.show-dots` on a cell to reveal the grid inside it (used in the Demo section). `.dot-reveal` fades the grid from one corner using a mask.

## Anti-patterns

| Avoid                                                  | Use instead                                |
| ------------------------------------------------------ | ------------------------------------------ |
| `rounded-*` on any element                             | No border-radius                           |
| `shadow-*` for elevation                               | Border lines                               |
| Nested `<div>` cards with background + padding         | `.cell` in a flat grid                     |
| Margin-based spacing between sections                  | `.hline` borders                           |
| Inline colour values                                   | CSS vars (`var(--muted)`, `var(--border)`) |
| `card`, `panel`, `box` abstractions                    | Direct grid markup                         |
| Multiple nesting levels for visual grouping            | Single-level sections                      |
| Global Tailwind utilities for spacing between sections | `.hline` + `py-8 px-10` pattern            |

## File locations

- Tokens + layout: `src/styles/base.css`
- Component classes: `src/styles/components.css`
- Sections: `src/components/sections/*.astro`
- Icons: `src/components/icons/*.astro`
- Page layout: `src/layouts/Layout.astro`
