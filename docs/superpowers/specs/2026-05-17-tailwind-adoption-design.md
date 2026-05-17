# Tailwind v4 + shadcn/ui adoption — design spec

**Date:** 2026-05-17
**Branch:** `feature/tailwind`
**Status:** Design approved, pending implementation plan

## Problem

`frontend/app/globals.css` has ~3,790 lines of landing-page CSS imported globally in `app/layout.tsx`. Three concrete pain points:

1. **Universal reset bleeds everywhere.** Line 22 (`* { box-sizing: border-box; margin: 0; padding: 0; }`) zeroes out padding/margin on every element of every route, not just the landing.
2. **Generic class names live in global scope.** Class names like `.card`, `.section`, `.container`, `.btn`, `.nav` are defined globally with landing-specific styles. Any component in `/app/*` that uses these names by accident inherits unwanted styles.
3. **No shared component layer.** Each product screen rewrites inline styles, leading to drift and inconsistency. The credentials screen specifically showed padding overrides this week, which triggered this initiative.

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

### File structure

```
frontend/app/
├── layout.tsx                    Root layout — imports new globals.css only
├── globals.css                   ~50 lines: @theme + @import "tailwindcss"
├── (landing)/                    Route group, no URL prefix
│   ├── layout.tsx                Wraps landing-only routes; imports landing.css
│   ├── landing.css               The current 3,790 lines, moved as-is
│   └── page.tsx                  The landing (moved from app/page.tsx)
├── app/                          /app/* product routes — clean of landing CSS
├── agents/                       Audited during implementation (see Open questions)
├── oauth/                        Audited during implementation
├── api/                          Backend, no CSS impact
└── components/
    └── ui/                       shadcn/ui copy-paste components
        └── button.tsx            First smoke-test component
```

The Next.js route group `(landing)` does not affect URLs — `/` remains `/`. It only scopes the layout (and therefore the CSS import) to landing routes.

### Token mapping (`@theme`)

Tailwind v4 defines design tokens in CSS via `@theme`. Tokens generate utility classes automatically (`bg-accent`, `text-text-dim`, `font-display`, etc).

New `globals.css`:

```css
@import "tailwindcss";

@theme {
  /* Brand colors */
  --color-bg: #05080A;
  --color-bg-2: #0A0F12;
  --color-bg-elev: #0B1014;
  --color-surface: #0D1316;
  --color-surface-2: #121A1E;
  --color-border: rgba(0, 229, 209, 0.12);
  --color-border-strong: rgba(0, 229, 209, 0.28);
  --color-text: #E8F4F3;
  --color-text-dim: #8A9A9A;
  --color-text-muted: #5C6A6A;
  --color-accent: #00E5D1;
  --color-accent-2: #2BD4E8;
  --color-accent-deep: #008C7F;
  --color-danger: #FF6B6B;

  /* Fonts */
  --font-display: 'Space Grotesk', 'Helvetica Neue', sans-serif;
  --font-body: 'Inter', 'Helvetica Neue', sans-serif;
  --font-mono: 'JetBrains Mono', 'Menlo', monospace;

  /* shadcn semantic aliases — point to brand tokens */
  --color-background: var(--color-bg);
  --color-foreground: var(--color-text);
  --color-primary: var(--color-accent);
  --color-primary-foreground: var(--color-bg);
  --color-muted: var(--color-surface);
  --color-muted-foreground: var(--color-text-dim);
}

html, body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-body);
  -webkit-font-smoothing: antialiased;
}
```

**What is intentionally NOT mapped** (uses Tailwind v4 defaults, which already align with current CSS):
- Spacing scale — Tailwind's `p-4` (16px), `p-6` (24px), `p-8` (32px) cover most current usage.
- Border radii — `rounded-lg` (12px), `rounded-full` (9999px) align with current values.
- Shadows — Tailwind defaults are sufficient.

**Coexistence with legacy CSS:** `landing.css` keeps its own `:root { --accent, --bg, ... }` block. The Tailwind `@theme` block uses the `--color-*` prefix. The two namespaces do not collide.

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

1. `pnpm dev` builds successfully with no Tailwind config errors.
2. The landing at `/` renders identically to before (visual diff via screenshots).
3. `/app/credentials` no longer has padding bleed from the universal reset.
4. The smoke-test `Button` on credentials renders with brand accent color.
5. `pnpm typecheck` and `pnpm test` pass (pre-commit hook gate).

## Open questions for implementation

These get resolved while writing the implementation plan, not now:

1. **Does `app/agents/` or `app/oauth/` depend visually on landing CSS classes?** If yes, decide whether to move them into the `(landing)` route group or copy the required styles into their own scoped CSS.
2. **Font loading strategy** — the current CSS references `Space Grotesk`, `Inter`, `JetBrains Mono` by name. Are they loaded via `next/font` already, or via a `<link>` tag in the document head? The implementation plan needs to confirm before migration.
3. **Pre-commit hook impact** — the hook runs `pnpm typecheck && pnpm test` workspace-wide. Tailwind install must not break either.

## Decisions summary

| Axis | Decision |
|---|---|
| Stack | Tailwind v4 + shadcn/ui (new-york style) |
| Legacy CSS handling | Moved to `app/(landing)/landing.css`, loaded only inside the `(landing)` route group |
| Token mapping | Brand colors + fonts via `@theme`; spacing, radii, shadows use Tailwind defaults |
| Coexistence | Tailwind `--color-*` namespace vs. landing `--accent` namespace — no collision |
| PR 1 scope | Foundation install + token mapping + legacy isolation + `Button` smoke-test on credentials |
| Future migrations | Component by component, on demand, separate PRs |
| Full landing refactor | Deferred indefinitely |
