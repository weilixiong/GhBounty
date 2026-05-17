# Tailwind v4 + shadcn/ui adoption — design spec

**Date:** 2026-05-17
**Branch:** `feature/tailwind`
**Status:** Design approved (revised 2026-05-17 after planning-time audit)

## Problem

`frontend/app/globals.css` has ~3,790 lines of CSS imported globally in `app/layout.tsx`. Three concrete pain points:

1. **Universal reset bleeds everywhere.** Line 22 (`* { box-sizing: border-box; margin: 0; padding: 0; }`) zeroes out padding/margin on every element of every route.
2. **No shared component layer.** Each product screen reuses or rewrites the same class strings, leading to drift and inconsistency. The credentials screen specifically showed padding overrides this week, which triggered this initiative.
3. **Everything is in one global file.** All design tokens, resets, landing-specific styles, and product/dashboard styles coexist in `globals.css`.

### Planning-time audit (added 2026-05-17)

Initial assumption: `globals.css` is "landing CSS" that can be moved into a route group. **This is false.** Audit of class usage shows `globals.css` is the **app's entire current design system**:

| Class family | Used by | Notes |
|---|---|---|
| `.nav`, `.hero`, `.section`, `.terminal-*`, `.track`, `.partner-*`, `.faq-*`, `.pipeline-*` | Landing only (`app/page.tsx`) | ~700 lines |
| `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-danger`, `.btn-sm` | Landing + `/app/*` + `/oauth/*` | App-wide |
| `.dash`, `.dash-hero`, `.dash-title`, `.dash-grid`, `.dash-col`, `.dash-toolbar`, `.dash-aside` | All `/app/*` + `/oauth/*` | ~800 lines (l.1285+) |
| `.modal`, `.modal-head`, `.modal-foot`, `.modal-narrow`, `.modal-backdrop`, `.modal-close` | `/app/*` modals | App-wide |
| `.field`, `.field-label`, `.form-error` | `/app/*` forms | App-wide |
| `.eyebrow`, `.app-loading`, `.loading-dot`, `.mono-inline`, `.profile-card`, `.token-pill`, `.section-label`, `.pick-*` | App-wide utilities | App-wide |

**Implication:** moving `globals.css` into a `(landing)` route group breaks `/app/credentials`, `/app/stake`, `/oauth/authorize`, etc. The original "isolate the legacy" strategy is therefore replaced by the strategy below.

## Goals

- Introduce **Tailwind v4** as the styling system for product routes (`/app/*` and forward).
- Introduce **shadcn/ui** as the component primitives library on top of Tailwind.
- Isolate the legacy landing CSS so it stops leaking into product routes.
- Preserve the existing brand identity (accent palette, fonts) as Tailwind design tokens.
- Establish a **gradual, component-by-component migration path** — no big-bang refactor.

## Non-goals

- Rewriting the landing page now or in the next several PRs.
- Migrating any feature screen that is not actively being touched.
- Adding a dark/light mode toggle (app is 100% dark mode by design).
- Changing the brand palette, typography, or visual identity.
- Pre-adding shadcn components "just in case" — components arrive only when a real consumer needs them.

## Architecture

### Coexistence-first strategy (revised)

`globals.css` is **not split** in this PR. It remains the global stylesheet for the whole app. Tailwind v4 is added on top by prepending `@import "tailwindcss"` and a `@theme` block. shadcn/ui components live in `frontend/components/ui/` and consume Tailwind utilities.

Migration happens **gradually**, one component at a time, in subsequent PRs. As a screen is migrated to shadcn + Tailwind, the legacy classes it used (`.btn`, `.dash-*`, `.modal-*`, etc.) become unused. Once a class has zero consumers across the codebase, it gets deleted from `globals.css`. When `globals.css` eventually contains only landing-specific classes, that's when (and only then) we evaluate isolating it into a route group.

### File structure

```
frontend/app/
├── layout.tsx                    Root layout — unchanged
├── globals.css                   Top of file: @import "tailwindcss" + @theme
│                                 Rest of file: legacy CSS, untouched
├── page.tsx                      Landing, unchanged
├── app/                          /app/* product routes, unchanged
├── agents/                       Unchanged
├── oauth/                        Unchanged
└── api/                          Unchanged

frontend/
├── components/
│   ├── ui/                       NEW — shadcn/ui copy-paste components
│   │   └── button.tsx            First smoke-test component
│   └── ...                       Existing components, unchanged
├── lib/
│   └── utils.ts                  NEW — cn() helper (clsx + tailwind-merge)
├── components.json               NEW — shadcn config
├── postcss.config.mjs            NEW — Tailwind v4 PostCSS plugin
└── package.json                  Adds: tailwindcss@4, @tailwindcss/postcss,
                                  postcss, clsx, tailwind-merge,
                                  class-variance-authority, lucide-react
```

No files are moved or renamed. No route groups are introduced. The landing keeps loading `globals.css` from the root layout exactly as today.

### Token mapping (`@theme`)

Tailwind v4 defines design tokens in CSS via `@theme`. Tokens generate utility classes automatically (`bg-accent`, `text-text-dim`, `font-display`, etc).

A new block goes **at the top** of `globals.css`, before the existing `:root` and all legacy rules:

```css
@import "tailwindcss";

@theme {
  /* Brand colors — duplicate of the legacy :root values, in --color-* namespace */
  --color-bg: #05080A;
  --color-bg-2: #0A0F12;
  --color-bg-elev: #0B1014;
  --color-surface: #0D1316;
  --color-surface-2: #121A1E;
  --color-border-brand: rgba(0, 229, 209, 0.12);
  --color-border-strong: rgba(0, 229, 209, 0.28);
  --color-text: #E8F4F3;
  --color-text-dim: #8A9A9A;
  --color-text-muted: #5C6A6A;
  --color-accent: #00E5D1;
  --color-accent-2: #2BD4E8;
  --color-accent-deep: #008C7F;
  --color-danger: #FF6B6B;

  /* Fonts — reference the next/font CSS variables already wired in app/layout.tsx */
  --font-display: var(--font-display);
  --font-body: var(--font-body);
  --font-mono: var(--font-mono);

  /* shadcn semantic aliases */
  --color-background: var(--color-bg);
  --color-foreground: var(--color-text);
  --color-primary: var(--color-accent);
  --color-primary-foreground: var(--color-bg);
  --color-muted: var(--color-surface);
  --color-muted-foreground: var(--color-text-dim);
}

/* All existing legacy CSS continues below this point, untouched. */
```

**Note on `--color-border-brand`:** the existing legacy CSS uses `--border` (and Tailwind's preflight uses `--border` for its own border color). Naming the brand token `--color-border-brand` avoids collisions. Utility class becomes `border-border-brand`.

**Note on fonts:** `frontend/app/layout.tsx` already loads Space Grotesk, Inter, and JetBrains Mono via `next/font/google` and exposes them as CSS variables `--font-display`, `--font-body`, `--font-mono` on `<html>`. The `@theme` references these existing variables — no font name strings duplicated.

**What is intentionally NOT mapped** (uses Tailwind v4 defaults):
- Spacing scale, border radii, shadows.

**Coexistence with legacy CSS:** the legacy `:root` block uses unprefixed names (`--accent`, `--bg`, etc.). The Tailwind `@theme` block uses the `--color-*` prefix. The two namespaces do not collide. Tailwind's Preflight is idempotent with the legacy `* { box-sizing; margin: 0; padding: 0 }` for the parts it overlaps; remaining legacy resets persist.

### shadcn/ui setup

Initialized via `pnpm dlx shadcn@latest init` with:

| Setting | Value |
|---|---|
| Style | `new-york` |
| Base color | `neutral` |
| CSS variables | yes |
| RSC | yes |
| TypeScript | yes |
| Component alias | `@/components` |
| Util alias | `@/lib/utils` |

Generated files:
- `components.json` — shadcn config
- `lib/utils.ts` — `cn()` helper (clsx + tailwind-merge)
- Additions to `globals.css` for shadcn's expected token names

### Smoke test

Add `Button` via `pnpm dlx shadcn@latest add button`. Replace the "Add API Key" button on `frontend/app/app/credentials/` with the shadcn `Button`. Verify visually that:

1. Color matches brand accent.
2. Padding is no longer overridden by legacy CSS.
3. The rest of the credentials screen is not visually broken.

If verified, the foundation is sound and subsequent component migrations proceed in separate PRs.

## Migration roadmap (post-foundation, informational)

Order of component additions (driven by real demand, not pre-emptive):

1. `Button` — this PR
2. `Card` — credentials, dashboard, stake
3. `Input` + `Label` — auth flows, API keys, stake forms
4. `Dialog` — revoke key, confirm stake modals
5. `Badge` — status pills
6. `Tabs` — credentials already uses tabs
7. `Toast` — action feedback
8. Everything else on demand

**Rule of thumb:** a shadcn component lands in the repo only when a real consumer in the same PR uses it. Avoids the common `components/ui/` graveyard of unused components.

**Per-screen migration convention:**
- Replace legacy CSS classes with Tailwind utility classes inline.
- If a pattern repeats 3+ times, extract to `components/ui/` (generic) or `components/<feature>/` (feature-specific).
- Do not touch `landing.css` until the eventual full landing refactor.

**Full landing refactor:** deferred. Triggered only when (a) the landing needs major changes AND (b) the core component set (Button/Card/Input/Dialog) is stable.

## Verification

Manual checks for the foundation PR:

1. `pnpm dev` runs with no Tailwind / PostCSS errors.
2. The landing at `/` renders identically to before (visual diff via screenshots) — no regression from Tailwind Preflight overlapping legacy resets.
3. `/app/credentials` and `/oauth/authorize` still render as today (legacy `.dash`, `.btn`, `.modal` etc. are untouched).
4. The smoke-test `Button` on credentials renders with brand accent color and demonstrates the migration pattern works.
5. A trivial Tailwind utility usage (e.g. `className="text-accent"`) on the same page resolves to the expected color, confirming `@theme` is wired.
6. `pnpm typecheck` and `pnpm test` pass (pre-commit hook gate).

## Open questions for implementation

Resolved during planning:

1. **`/oauth/*` dependency on legacy CSS** — confirmed: heavy use of `.dash`, `.dash-hero`, `.eyebrow`, `.app-loading`, `.loading-dot`, `.mono-inline`. **Resolution:** coexistence-first strategy — `globals.css` stays in place, no isolation in this PR.
2. **`/agents/*` dependency** — uses its own `agents.module.css` (CSS module, scoped). No globals.css coupling beyond tokens.
3. **Font loading** — already wired via `next/font/google` in `app/layout.tsx` exposing CSS variables `--font-display`, `--font-body`, `--font-mono`. **Resolution:** `@theme` references these existing variables.
4. **Pre-commit hook** — runs `pnpm typecheck && pnpm test` workspace-wide. Plan must keep both passing at every commit.

## Decisions summary

| Axis | Decision |
|---|---|
| Stack | Tailwind v4 + shadcn/ui (new-york style) |
| Legacy CSS handling | **Unchanged in this PR.** Tailwind imports and `@theme` prepended to `globals.css`; rest of the file untouched. Isolation is deferred to gradual per-component erosion. |
| Token mapping | Brand colors + font references via `@theme`; spacing, radii, shadows use Tailwind defaults |
| Coexistence | Tailwind `--color-*` namespace vs. legacy `--accent` namespace — no collision |
| PR 1 scope | Tailwind install + token mapping + shadcn init + `Button` smoke-test on credentials |
| Future migrations | Component by component, on demand. Legacy classes deleted from `globals.css` only when they have zero consumers. |
| Full landing refactor | Deferred indefinitely |
