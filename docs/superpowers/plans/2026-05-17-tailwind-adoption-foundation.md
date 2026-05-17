# Tailwind v4 + shadcn/ui Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install Tailwind v4 and shadcn/ui in the `frontend/` workspace, map brand tokens to `@theme`, and verify the setup end-to-end with a single shadcn `Button` smoke-test in the credentials page.

**Architecture:** Coexistence-first — `globals.css` keeps its 3,790 lines of legacy design-system CSS untouched. Tailwind v4 is added at the top via `@import "tailwindcss"` + a `@theme` block referencing brand tokens. shadcn/ui components live in `frontend/components/ui/`. No file moves, no route groups, no isolation. Migration is gradual in future PRs.

**Tech Stack:** Next.js 16 (App Router) · React 19 · pnpm workspace · Tailwind v4 (PostCSS plugin) · shadcn/ui (new-york style) · clsx + tailwind-merge + class-variance-authority · lucide-react

**Spec:** `docs/superpowers/specs/2026-05-17-tailwind-adoption-design.md`

**Working directory for all `pnpm` commands:** repo root (`/Users/gastonfoncea/Documents/Startups/GhBounty`) unless explicitly stated.

---

## Phase 0 — Pre-flight

### Task 0: Confirm clean working tree on `feature/tailwind`

**Files:** none

- [ ] **Step 1: Verify branch and clean tree**

Run:
```bash
git status
git branch --show-current
```
Expected:
```
On branch feature/tailwind
nothing to commit, working tree clean
```

If not clean, stop and resolve before continuing.

---

## Phase 1 — Install Tailwind v4

### Task 1: Add Tailwind v4 dev dependencies

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install deps**

Run from repo root:
```bash
pnpm --filter frontend add -D tailwindcss@latest @tailwindcss/postcss@latest postcss@latest
```

- [ ] **Step 2: Verify deps in package.json**

Run:
```bash
grep -E '"tailwindcss"|"@tailwindcss/postcss"|"postcss"' frontend/package.json
```
Expected: three matches showing the installed versions under `devDependencies`.

- [ ] **Step 3: Verify lockfile updated**

Run:
```bash
git status --short pnpm-lock.yaml frontend/package.json
```
Expected: both files modified.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json pnpm-lock.yaml
git commit -m "chore(frontend): install tailwindcss v4 + postcss plugin

Foundation for tailwind adoption (feature/tailwind branch). No styles
change yet — wiring only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Create PostCSS config for Tailwind v4

**Files:**
- Create: `frontend/postcss.config.mjs`

- [ ] **Step 1: Create the config file**

Create `frontend/postcss.config.mjs` with exactly this content:

```js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

- [ ] **Step 2: Verify file content**

Run:
```bash
cat frontend/postcss.config.mjs
```
Expected: the four-line config above.

- [ ] **Step 3: Commit**

```bash
git add frontend/postcss.config.mjs
git commit -m "chore(frontend): add postcss config for tailwind v4

@tailwindcss/postcss plugin wires Tailwind into Next.js 16's build per
Next docs: node_modules/next/dist/docs/01-app/01-getting-started/11-css.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Add Tailwind import + brand `@theme` to globals.css

**Files:**
- Modify: `frontend/app/globals.css:1` (prepend new lines)

- [ ] **Step 1: Read current first line of globals.css**

Run:
```bash
head -5 frontend/app/globals.css
```
Expected first line: `/* GH Bounty — Landing styles */`

The new content goes **above** this line. The rest of the file is untouched.

- [ ] **Step 2: Edit globals.css — prepend Tailwind import + @theme**

Insert the following block at the very top of `frontend/app/globals.css`, before the existing `/* GH Bounty — Landing styles */` comment:

```css
@import "tailwindcss";

/* ============================================================
 * Tailwind v4 design tokens — generates utility classes like
 * `bg-bg`, `text-accent`, `font-display`, `border-border-brand`.
 *
 * Brand color names mirror the legacy :root vars below (kept
 * unprefixed for backwards compat with existing landing/app CSS).
 * Tailwind tokens live under the `--color-*` namespace so the two
 * systems coexist without collision.
 * ============================================================ */
@theme {
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

  /* Fonts — declared here as fallbacks. next/font in app/layout.tsx
   * sets hashed CSS variables (--font-display, --font-body, --font-mono)
   * on <html> at runtime, which override these via cascade specificity. */
  --font-display: 'Space Grotesk', 'Helvetica Neue', sans-serif;
  --font-body: 'Inter', 'Helvetica Neue', sans-serif;
  --font-mono: 'JetBrains Mono', 'Menlo', monospace;

  /* shadcn semantic aliases — point at brand tokens so shadcn components
   * inherit our palette without us editing each component. */
  --color-background: var(--color-bg);
  --color-foreground: var(--color-text);
  --color-primary: var(--color-accent);
  --color-primary-foreground: var(--color-bg);
  --color-muted: var(--color-surface);
  --color-muted-foreground: var(--color-text-dim);
}

/* ============================================================
 * Legacy design system below — DO NOT REMOVE in this PR.
 * Used by /app/*, /oauth/*, and the landing. Will be eroded
 * gradually in subsequent component migrations.
 * ============================================================ */

```

- [ ] **Step 3: Verify file structure**

Run:
```bash
head -50 frontend/app/globals.css
```
Expected: the new `@import "tailwindcss";` is line 1, the `@theme` block follows, and the original `/* GH Bounty — Landing styles */` is still present below.

Run:
```bash
wc -l frontend/app/globals.css
```
Expected: ~3,790 + ~45 added lines = ~3,835 lines.

- [ ] **Step 4: Run typecheck (should still pass, no TS changes)**

Run:
```bash
pnpm typecheck
```
Expected: all workspace projects pass.

- [ ] **Step 5: Run `next dev` smoke test**

Run from `frontend/`:
```bash
pnpm --filter frontend dev
```
Wait for `✓ Ready in ...`. Then:
- Open `http://localhost:3000/` — landing should render unchanged.
- Open `http://localhost:3000/app/credentials` — should render as before (legacy CSS still works).
- Check terminal for any PostCSS / Tailwind errors. Expected: none.

Kill the dev server (Ctrl+C) before continuing.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat(frontend): wire tailwind v4 @theme with brand tokens

@import \"tailwindcss\" at top of globals.css; @theme block exposes
brand colors (accent, bg, surface, text variants) and font slots as
Tailwind utility classes (text-accent, bg-surface, font-display, ...).

Legacy CSS untouched — coexistence strategy per spec.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — Initialize shadcn/ui

### Task 4: Install shadcn runtime dependencies

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install deps**

Run from repo root:
```bash
pnpm --filter frontend add clsx tailwind-merge class-variance-authority lucide-react
```

These are the runtime helpers every shadcn component imports:
- `clsx` + `tailwind-merge` → composed into `cn()` in `lib/utils.ts`
- `class-variance-authority` → variant API for Button, Badge, etc.
- `lucide-react` → icon set used by shadcn defaults

- [ ] **Step 2: Verify**

Run:
```bash
grep -E '"clsx"|"tailwind-merge"|"class-variance-authority"|"lucide-react"' frontend/package.json
```
Expected: four matches under `dependencies`.

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json pnpm-lock.yaml
git commit -m "chore(frontend): install shadcn/ui runtime deps

clsx + tailwind-merge for cn() helper; class-variance-authority for
component variants; lucide-react for icons.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Create `lib/utils.ts` with `cn()` helper

**Files:**
- Create: `frontend/lib/utils.ts`

- [ ] **Step 1: Confirm path is available**

Run:
```bash
ls frontend/lib/utils.ts 2>/dev/null && echo "EXISTS — STOP" || echo "OK to create"
```
Expected: `OK to create`. If `EXISTS — STOP`, read the existing file and surface to the user before continuing.

- [ ] **Step 2: Create the file**

Write `frontend/lib/utils.ts` with exactly this content:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class strings with conflict resolution.
 *
 * `clsx` filters falsy values; `twMerge` resolves conflicts so that
 * `cn("p-2", "p-4")` returns `"p-4"` instead of both.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3: Run typecheck**

Run:
```bash
pnpm --filter frontend typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/utils.ts
git commit -m "feat(frontend): add cn() helper for shadcn/ui

clsx + tailwind-merge composition used by every shadcn component to
compose className with conflict-aware merging.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Create `components.json` (shadcn config)

**Files:**
- Create: `frontend/components.json`

- [ ] **Step 1: Confirm path is available**

Run:
```bash
ls frontend/components.json 2>/dev/null && echo "EXISTS — STOP" || echo "OK to create"
```
Expected: `OK to create`.

- [ ] **Step 2: Create the file**

Write `frontend/components.json` with exactly this content:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

Notes for the engineer:
- `"tailwind.config": ""` is intentional — Tailwind v4 has no JS config; everything is CSS via `@theme`.
- `"tailwind.css": "app/globals.css"` is relative to `frontend/` (where `components.json` lives).
- `"rsc": true` because Next 16 App Router is RSC-by-default.
- `"baseColor": "neutral"` — shadcn's neutral palette is overridden by our `@theme` aliases (`--color-primary`, `--color-background`, etc.) so this is mostly a no-op.

- [ ] **Step 3: Commit**

```bash
git add frontend/components.json
git commit -m "chore(frontend): add shadcn/ui components.json

new-york style, RSC enabled, aliases match tsconfig paths.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — Smoke test with Button

### Task 7: Add the shadcn `Button` component

**Files:**
- Create: `frontend/components/ui/button.tsx`

- [ ] **Step 1: Run shadcn add from frontend/**

Run:
```bash
cd frontend && pnpm dlx shadcn@latest add button --yes
```

The `--yes` flag skips interactive overwrite prompts. Expected output:
```
✔ Checking registry.
✔ Created 1 file:
   - components/ui/button.tsx
```

Note: if the CLI reports needing to update `globals.css` with additional `@layer base` tokens, **review the diff before accepting** — we do not want to lose our `@theme` block. If conflict, ask the user before resolving.

- [ ] **Step 2: Verify file exists**

Run:
```bash
ls frontend/components/ui/button.tsx && head -30 frontend/components/ui/button.tsx
```
Expected: file exists, starts with imports from `@radix-ui/react-slot`, `class-variance-authority`, and `@/lib/utils`.

- [ ] **Step 3: Verify Radix Slot was auto-installed**

Run:
```bash
grep '"@radix-ui/react-slot"' frontend/package.json
```
Expected: one match. If missing, run `pnpm --filter frontend add @radix-ui/react-slot`.

- [ ] **Step 4: Typecheck**

Run:
```bash
pnpm --filter frontend typecheck
```
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ui/button.tsx frontend/package.json pnpm-lock.yaml
git commit -m "feat(frontend): add shadcn Button as first ui primitive

Smoke-test component for the Tailwind/shadcn foundation. Consumed by
credentials in next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Replace one button in credentials with shadcn `Button`

**Files:**
- Modify: `frontend/app/app/credentials/ApiKeysSection.tsx`

The target is the "Generate" button at line 123 currently using `className="btn btn-primary btn-sm"`.

- [ ] **Step 1: Locate the button**

Run:
```bash
grep -n "btn btn-primary btn-sm" frontend/app/app/credentials/ApiKeysSection.tsx
```
Expected: line 123 (or nearby — confirm before editing).

- [ ] **Step 2: Read the surrounding 10 lines for context**

Read `frontend/app/app/credentials/ApiKeysSection.tsx` lines 115-135 to see the exact button JSX.

- [ ] **Step 3: Add the import**

Add to the top of `frontend/app/app/credentials/ApiKeysSection.tsx` (alongside other component imports):

```tsx
import { Button } from "@/components/ui/button";
```

- [ ] **Step 4: Replace the button**

Change from:
```tsx
<button
  type="button"
  className="btn btn-primary btn-sm"
  onClick={...}
>
  {...children}
</button>
```

to:
```tsx
<Button
  type="button"
  size="sm"
  onClick={...}
>
  {...children}
</Button>
```

Keep `onClick`, `type`, and children identical to the original. Only `className` is replaced by the `size` variant prop. If the original passes other props (`disabled`, `aria-*`), keep them — `Button` forwards them via Radix Slot.

- [ ] **Step 5: Typecheck**

Run:
```bash
pnpm --filter frontend typecheck
```
Expected: passes. If a type error mentions a missing prop on `Button`, check the generated `button.tsx` for the exact variant/size options.

- [ ] **Step 6: Visual verify in dev server**

Run:
```bash
pnpm --filter frontend dev
```

In the browser:
1. Open `http://localhost:3000/app/credentials`
2. Locate the "Generate" button — it should render with the shadcn `Button` (will look different from the legacy `.btn-primary` until we tune variants).
3. Confirm:
   - No console errors
   - The button is clickable
   - The rest of the page (legacy `.dash-*`, `.btn-*` elsewhere) is unchanged

If the visual is too off-brand for the smoke test, that's expected — variant tuning is a follow-up PR. The point here is to verify the wiring works end-to-end.

Kill dev server.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/app/credentials/ApiKeysSection.tsx
git commit -m "feat(frontend): swap credentials Generate button to shadcn Button

Smoke-test of the Tailwind + shadcn foundation. Proves end-to-end:
@theme tokens → @/components/ui/button → consumed by feature code.
Visual will be tuned to match brand in a follow-up PR.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — Verification

### Task 9: Workspace typecheck + test

**Files:** none

- [ ] **Step 1: Run workspace typecheck**

Run:
```bash
pnpm typecheck
```
Expected: all 7 workspace projects pass.

- [ ] **Step 2: Run workspace tests**

Run:
```bash
pnpm test
```
Expected: all packages green. Vitest in frontend may pass with 0 tests — fine.

If either fails, stop and surface to the user. Do not "fix" by reverting tasks above — the failure is a real problem to understand.

---

### Task 10: Production build

**Files:** none

- [ ] **Step 1: Build frontend**

Run:
```bash
pnpm --filter frontend build
```
Expected: build succeeds with no errors. Tailwind will compile in production mode; CSS chunking will produce smaller bundles.

- [ ] **Step 2: Check bundle size signal**

Run:
```bash
ls -lh frontend/.next/static/css/ 2>/dev/null | head -5
```
Expected: at least one `.css` file. Note size — should be reasonable (under 200KB is fine; this is a one-time baseline).

---

### Task 11: Manual landing regression check

**Files:** none

- [ ] **Step 1: Run dev server**

Run:
```bash
pnpm --filter frontend dev
```

- [ ] **Step 2: Walk every public route briefly**

In the browser:
1. `/` — landing. Compare to current production (`https://ghbounty.com` or your reference). No visual regressions expected.
2. `/app/credentials` — Generate button now uses shadcn; rest of page should look identical to before.
3. `/oauth/authorize?...` — if you have a test client, verify the consent screen still uses `.dash-hero` etc. (Skip if no test client.)

Take screenshots for the PR description.

Kill dev server.

---

## Phase 5 — PR prep

### Task 12: Sanity check the diff

**Files:** none

- [ ] **Step 1: Review the full branch diff**

Run:
```bash
git log --oneline main..feature/tailwind
git diff --stat main..feature/tailwind
```

Expected: ~7-9 commits, modest line count (most lines should be in the `@theme` block and the new `button.tsx`).

- [ ] **Step 2: Confirm no unintended files**

Run:
```bash
git diff --name-only main..feature/tailwind
```

Expected files:
- `docs/superpowers/specs/2026-05-17-tailwind-adoption-design.md` (already in earlier commits on this branch)
- `docs/superpowers/plans/2026-05-17-tailwind-adoption-foundation.md` (this plan)
- `frontend/package.json`
- `pnpm-lock.yaml`
- `frontend/postcss.config.mjs`
- `frontend/app/globals.css`
- `frontend/lib/utils.ts`
- `frontend/components.json`
- `frontend/components/ui/button.tsx`
- `frontend/app/app/credentials/ApiKeysSection.tsx`

No other files should appear. If they do, investigate before opening the PR.

---

### Task 13: Open PR

**Files:** none

- [ ] **Step 1: Push branch**

```bash
git push -u origin feature/tailwind
```

- [ ] **Step 2: Open PR**

Run:
```bash
gh pr create --title "feat(frontend): tailwind v4 + shadcn/ui foundation" --body "$(cat <<'EOF'
## Summary
- Installs Tailwind v4 (`@tailwindcss/postcss` plugin) and shadcn/ui (`new-york` style) into `frontend/`
- Maps brand tokens (`accent`, `bg`, `surface`, `text-*`, fonts) to `@theme` so they're available as utility classes (`text-accent`, `bg-surface`, `font-display`)
- Adds the first shadcn primitive: `Button`. Replaces the "Generate" button on `/app/credentials` as an end-to-end smoke test
- **Legacy `globals.css` is untouched** — `.btn`, `.dash-*`, `.modal-*`, etc. still work everywhere they did before. See spec for the coexistence strategy.

## Spec & plan
- Spec: `docs/superpowers/specs/2026-05-17-tailwind-adoption-design.md`
- Plan: `docs/superpowers/plans/2026-05-17-tailwind-adoption-foundation.md`

## Test plan
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] `pnpm --filter frontend build` succeeds
- [ ] Landing at `/` renders unchanged (screenshot)
- [ ] `/app/credentials` renders with new shadcn Button, rest of page unchanged (screenshot)
- [ ] `/oauth/authorize` still works if a test client is available

## Next PRs (informational, not part of this one)
- Card primitive + migrate credentials cards
- Input/Label primitives + migrate credentials forms
- Dialog primitive + migrate revoke/generate modals
- etc.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Return the PR URL to the user.**

---

## Self-review checklist (for the implementing engineer)

Before marking this plan complete:

1. **No legacy CSS removed.** `wc -l frontend/app/globals.css` should be ~3,835 (legacy 3,790 + new ~45 lines), NOT smaller.
2. **No route group `(landing)` created.** This was deliberately rejected during planning.
3. **No font duplication.** `next/font` in `app/layout.tsx` is the source of truth for the hashed font variables; `@theme` only declares fallbacks.
4. **One button changed, not many.** The smoke test is intentionally minimal — one button in credentials. Resist the urge to "while I'm here, migrate the others."
5. **Pre-commit hook never bypassed.** Per CLAUDE.md.
