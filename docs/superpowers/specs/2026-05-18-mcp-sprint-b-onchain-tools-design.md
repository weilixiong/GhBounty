# MCP Sprint B — On-chain tools (submit_pr) — design

**Status:** Spec (approved 2026-05-18, ready for implementation plan)
**Owner:** Gaston
**Created:** 2026-05-18
**Predecessor:** `2026-05-12-mcp-sprint-b-onchain-tools-outline.md` (outline only; superseded by this spec)
**Linear:** GHB-187 (this sprint), GHB-114 (`submit_pr`), GHB-182 (PR ownership bug, fixed here)

---

## TL;DR

Sprint B agrega la pieza que faltaba para que el MCP sea write-capable: la tool `submit_pr`. El agente AI puede ahora encontrar un bounty, resolverlo, y submitearlo on-chain en una sola call — sin browser ni intervención humana per-action. También cerramos GHB-182 (PR ownership bug) con defensa en profundidad y endurecemos el role gating de las tools on-chain.

Scope mínimo (~7 días):
1. `submissions.create` (alias `submit_pr`) — dev-only
2. `submissions.list` — dev-only
3. Hard role gating en todas las tools on-chain
4. Privy delegated server-signing para Solana
5. UX de consent en `/app/credentials`
6. Fix GHB-182: pre-check en MCP + post-check en relayer

Lo que NO entra: tools del lado company (create_bounty, resolve_bounty, etc.), on-chain ownership check, hash commit del Opus report.

---

## Goals & non-goals

**Goals**
- Un agente AI con API key + wallet delegated puede submitear PRs autónomamente.
- El user mantiene control: consent explícito al delegar, revoke con un click.
- Defense in depth contra el bug de PR ownership (GHB-182).
- Mantener el modelo de datos actual (`submissions.solver === profile.wallet_pubkey`); no introducir agent wallets dedicadas.

**Non-goals**
- Tools company-side. Salen en otro sprint.
- Soporte para chains no-Solana. Se sigue asumiendo Solana exclusivo.
- Refactor on-chain del programa Anchor (ownership check on-chain, redeploy con ix de stake). Tracked en GHB-195.
- Commit on-chain del `opus_report_hash` post-scoring. Continúa con el patrón actual de ceros.
- Webhooks (push) para status updates. Se mantiene polling vía `submissions.get`.

---

## Decisiones tomadas durante el brainstorming

1. **Signing model: Privy delegated server-signing** (Opción A). Elegida sobre:
   - B (agent wallet dedicada): cambiaría el data model y rompería authz existente.
   - C (two-step client signing): inviable para agentes AI sin wallet nativo (Claude Code, Cursor).
   - D (permits on-chain): requiere redeploy del programa, fuera de scope.
   - "Browser handoff per submit": derrota el propósito de tener un agente. Confirmado como anti-pattern (ver `project_agent_autonomy_principle` en memory).

2. **GHB-182 fix: 2 + 3 (MCP pre-check + relayer post-check)**. No tocamos el programa Anchor.

3. **`opus_report_hash` queda en ceros** (mismo patrón que la web app).

4. **`submit_pr` idempotente** por `(user_id, bounty_id, pr_url)` — reintento del agente no crea duplicados.

5. **Consent UI vive en `/app/credentials`**, no en pantalla separada. Mismo flow de onboarding.

---

## Arquitectura

```
┌──────────────┐   API key       ┌─────────────────┐   Privy server SDK   ┌──────────┐
│  AI agent    │────────────────▶│  apps/mcp       │─────────────────────▶│  Privy   │
│ (Claude Code,│   submit_pr     │  + role gating  │   signTransaction    │ (Solana) │
│  Cursor...)  │                 │  + GHB-182 ckpt │                      └──────────┘
└──────────────┘                 └────────┬────────┘                            │
                                          │                                     │
                                          │ /api/gas-station/sponsor            │
                                          ▼                                     ▼
                                 ┌─────────────────┐                    ┌──────────────┐
                                 │ gas station     │───────────────────▶│  Solana RPC  │
                                 │ validator+signer│   signed tx        │  (devnet)    │
                                 └─────────────────┘                    └──────────────┘
                                                                               │
                                                                               │ on-chain
                                                                               ▼
                                                                       ┌──────────────┐
                                                                       │   relayer    │
                                                                       │ + GHB-182    │
                                                                       │ post-check   │
                                                                       └──────────────┘
```

**Resumen del flujo:** el agente llama `submit_pr` con su API key. El MCP valida (rol dev + wallet delegated + ownership de PR via GitHub). Arma la tx. Pide a Privy server SDK la firma como solver (en nombre del user). Pasa al gas station para fee payer signing + submit. Devuelve `submission_id` al agente. El relayer la ve on-chain y revalida ownership antes de scorear.

---

## Componentes por paquete

### `apps/mcp/`

Archivos nuevos:
- `lib/tools/submissions/list.ts` — tool `submissions.list`. Dev-only. Devuelve submissions del solver (paginación cursor-based, fields: `id, bounty_id, pr_url, state, score, score_source, rank, created_at`).
- `lib/tools/submissions/create.ts` — tool `submissions.create` (a.k.a. `submit_pr`). Dev-only. Orquesta validation → tx build → Privy signing → gas station submit.
- `lib/tools/role-guard.ts` — helper `requireRole(profile, "dev" | "company")` que tira `Forbidden` si no matchea. Aplicado en cada tool on-chain.
- `lib/tools/delegation-guard.ts` — helper `requireWalletDelegated(userId)` que consulta `agent_delegations` y tira `Forbidden` si no.
- `lib/github/verify-pr-ownership.ts` — wrapper de GitHub REST API. Inputs: `pr_url`, expected `github_handle`, expected `repo`. Outputs: `{ ok: true } | { ok: false, reason }`.
- `lib/privy/delegated-signer.ts` — wrapper del Privy server SDK. Método: `signSolanaTransaction(userId, txBytes) → signedTxBytes`. Maneja errores (delegación revocada off-band, Privy down, etc.).
- `lib/solana/build-submit-solution-tx.ts` — replica server-side de `frontend/lib/solana.ts:buildSubmitSolutionIx` (fetch submission_count, derive PDA, build ix, wrap en VersionedTransaction con fee payer = gas station).

Cambios a archivos existentes:
- `lib/tools/register.ts` — registrar `submissions.list` y `submissions.create`.
- `lib/tools/bounties/list.ts`, `lib/tools/bounties/get.ts` — **sin cambios de rol**. Listar y leer bounties es info pública; el gating duro va en las tools que ejecutan acciones on-chain (`submissions.create`, futuras tools company), no en las read-only. `bounties.get` ya tiene el comportamiento de "agregar `my_submission` solo si role === dev", que se mantiene.
- `lib/tools/submissions/get.ts` — sin cambios funcionales; agregar tests para los nuevos paths.

### `frontend/`

> ⚠️ Nota del proyecto: `frontend/AGENTS.md` advierte que esta versión de Next.js tiene breaking changes vs lo que un agente AI puede tener en su training data. Leer la doc relevante en `node_modules/next/dist/docs/` antes de tocar código del frontend.

- `app/app/credentials/` — agregar sección **"Authorize agent to act on-chain"**.
  - Estado UI: `not_authorized` / `authorized` / `revoking`.
  - Botón "Authorize" llama `useHeadlessDelegatedActions.delegateWallet({ address, chainType: 'solana' })`.
  - Botón "Revoke authorization" llama `revokeWallets()`.
  - Persistir el estado local en `agent_delegations` table vía API call al `/api/agent-delegation/upsert` (nuevo endpoint server-side) que reciba la confirmación del frontend y escriba el row.
  - Copy del consent screen (ver sección "UX copy" más abajo).
- `app/api/agent-delegation/` — nuevo endpoint Next.js para syncear el estado a la DB.

### `relayer/`

- `src/submission-handler.ts` — antes de scorear, ejecutar `verify-pr-ownership` (lib compartida).
  - Si falla: `UPDATE submissions SET state='auto_rejected'`, skip scoring, log estructurado con razón.
  - Si pasa: continuar con el flow actual (Opus → ranking → evaluations row).
- Compartir el código de verify con MCP via `packages/shared/src/github/verify-pr-ownership.ts`.

### `packages/db/`

Nueva tabla `agent_delegations`:

```sql
CREATE TABLE agent_delegations (
  user_id text PRIMARY KEY REFERENCES profiles(user_id) ON DELETE CASCADE,
  wallet_pubkey text NOT NULL,
  chain_type text NOT NULL,  -- 'solana' por ahora
  delegated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_delegations_active
  ON agent_delegations (user_id) WHERE revoked_at IS NULL;
```

Implementación vía Drizzle (editar `packages/db/src/schema.ts` + `pnpm db:generate` + commit del SQL + Gaston aplica con `pnpm db:migrate`). NO sql ad-hoc en Studio.

RLS: habilitada con policy "user lee su propio row". El MCP server escribe vía `supabaseAdmin()` (service role, bypassea RLS), igual que el resto del schema. La policy importa para clientes con session token (frontend); el MCP no la atraviesa.

### `packages/shared/`

- `src/github/verify-pr-ownership.ts` — lib compartida MCP + relayer. Cero deps de Supabase o Privy (puro).
  - Input: `{ pr_url: string, expected_github_handle: string, expected_repo_url: string }`
  - Output: `{ ok: true } | { ok: false, reason: 'pr_not_found' | 'author_mismatch' | 'repo_mismatch' | 'rate_limited' }`
  - Usa `fetch` contra `https://api.github.com/repos/{owner}/{repo}/pulls/{number}` con token de servicio (no del user — esto es read-only para info pública).

---

## Data flow — submit_pr happy path

```
1. AI agent → POST https://mcp.ghbounty.com/api/mcp/mcp
   header: Authorization: Bearer ghbk_live_xxx
   body: { jsonrpc: "2.0", id: 1, method: "tools/call",
           params: { name: "submissions.create",
                     arguments: { bounty_id: "uuid", pr_url: "https://github.com/x/y/pull/123" } } }

2. apps/mcp/lib/tools/submissions/create.ts
   ├─ authenticate(authorization) → profile { user_id, role, wallet_pubkey, github_handle, mcp_status }
   ├─ requireRole(profile, "dev")           → 403 si role === "company"
   ├─ requireMcpStatus(profile, "active")   → 403 si suspended/revoked/pending_*
   ├─ requireWalletDelegated(user_id)       → 403 si no hay row activa en agent_delegations
   ├─ idempotency check:
   │     SELECT id, state FROM submissions
   │     WHERE solver = profile.wallet_pubkey
   │       AND issue_pda = (SELECT pda FROM issues WHERE id = $bounty_id)
   │       AND pr_url = $pr_url
   │     LIMIT 1
   │   ↳ si existe: devolver { submission_id, status: state }. Fin.
   ├─ load bounty: SELECT id, pda, github_issue_url, state, chain_id FROM issues WHERE id = $bounty_id
   │   ↳ 404 si no existe; 409 si state ≠ 'open'
   │   parsear repo del bounty: github_issue_url → { owner, repo, issue_number }
   ├─ verify-pr-ownership({
   │     pr_url,
   │     expected_github_handle: profile.github_handle,
   │     expected_repo_url: `https://github.com/${owner}/${repo}`
   │   })
   │   ↳ ok: continue. fail: devolver 403 con la razón.
   ├─ fetch on-chain bounty: program.account.bounty.fetch(bounty_pda) → submission_count
   ├─ derive submission PDA con [SUBMISSION_SEED, bounty_pda, u32LE(submission_count)]
   ├─ build submit_solution ix (pr_url, opus_report_hash = zeros[32])
   ├─ wrap en VersionedTransaction:
   │     fee payer: gas station pubkey
   │     signers required: gas station (slot 0), user wallet (slot 1)
   ├─ serialize → unsigned bytes
   ├─ Privy delegated signing:
   │     await privyClient.walletApi.solana.signTransaction({
   │       walletId: <derived from profile.wallet_pubkey>,
   │       transaction: unsignedBytes
   │     })
   │   ↳ devuelve tx con slot 1 firmado (el user)
   │   ↳ si Privy 403 (delegación revocada off-band): UPDATE agent_delegations SET revoked_at = now();
   │                                                   devolver 403 al agente
   ├─ POST /api/gas-station/sponsor con la tx parcial:
   │     gas station validator chequea allowlist de discriminators (submit_solution ya está ahí)
   │     agrega su firma → submit a Solana RPC
   ├─ wait for tx confirmation (timeout 30s):
   │     getSignatureStatuses con retry/backoff
   │   ↳ si timeout: devolver 202 con { submission_id: null, status: 'pending', tx_signature }
   │                  el agente puede pollear submissions.get
   ├─ insert mirror local en submissions:
   │     INSERT INTO submissions (pda, solver, pr_url, opus_report_hash, state, ...)
   │     VALUES (...)
   │     ON CONFLICT (pda) DO NOTHING
   │   ↳ el relayer también lo va a insertar; ON CONFLICT evita la race
   └─ devolver { submission_id, status: 'pending', tx_signature, submission_pda }

3. relayer/src/watcher.ts ve la submission nueva en la cadena
   ├─ verify-pr-ownership(pr_url, github_handle_del_solver, bounty.repo)
   │     github_handle se obtiene via JOIN: solver_wallet → profiles → github_handle
   │   ↳ fail: UPDATE submissions SET state = 'auto_rejected'; log; skip
   │   ↳ ok: continue
   ├─ scorea con Opus (sin cambios al flow actual)
   ├─ INSERT INTO evaluations (...)
   └─ UPDATE submissions SET state = 'scored', rank = ..., scored_at = now()

4. AI agent loopea submissions.get(submission_id) hasta ver state='scored'
   ↳ sin cambios — submissions.get ya devuelve score + state. Documentar el polling pattern en el agente skill.
```

---

## Error handling + edge cases

| Caso | HTTP/MCP Error | Mensaje al agente |
|---|---|---|
| API key inválida | 401 `Unauthorized` | "Invalid or expired API key" |
| Rol = company | 403 `Forbidden` | "This tool requires `dev` role" |
| mcp_status ≠ active | 403 `Forbidden` | "Account is suspended/revoked. Contact support." |
| User no delegó wallet | 403 `Forbidden` | "Wallet delegation required — visit /app/credentials to authorize." |
| Bounty no existe | 404 `NotFound` | "Bounty not found" |
| Bounty no está open | 409 `Conflict` | "Bounty is `{state}` and not accepting submissions" |
| PR no existe en GitHub (404) | 404 `NotFound` | "PR does not exist on GitHub" |
| PR author ≠ github_handle | 403 `Forbidden` | "PR author does not match your linked GitHub account" |
| PR repo ≠ bounty repo | 403 `Forbidden` | "PR is not against the bounty's target repo" |
| GitHub rate limit | 503 `ServiceUnavailable` | "GitHub rate limit hit, retry in N seconds" |
| Duplicate (idempotent hit) | 200 con `submission_id` existente | (sin error; respuesta normal con el id de la previa) |
| Privy signing fail (delegación revocada) | 403 `Forbidden` | "Wallet delegation revoked — re-authorize at /app/credentials" |
| Privy down | 503 `ServiceUnavailable` | "Signing service unavailable, retry shortly" |
| Gas station rechaza (allowlist miss) | 500 `InternalError` + alert | "Internal validation error" |
| On-chain submission_count race | reintento automático 1 vez | (transparente para el agente) |
| On-chain tx fail (otros) | 500 `InternalError` + log | "On-chain submission failed: <reason>" |
| Confirmation timeout | 202 con `tx_signature`, sin `submission_id` | "Tx submitted, confirmation pending — check submissions.get" |
| Relayer detecta mismatch (post-check fail) | (no es error real-time; el agente ve `state=auto_rejected` via submissions.get) | - |

---

## UX copy — consent screen

En `/app/credentials`, debajo del bloque de API keys:

> ### Authorize agent to act on-chain
>
> Your AI agent needs permission to sign Solana transactions on your behalf to submit PRs to bounties. Without this, every action would require you to open a browser and confirm — which defeats the point of having an agent.
>
> **What you're authorizing:**
> - GhBounty server can sign `submit_solution` transactions using your wallet (`<wallet pubkey>`)
> - This is scoped to the GhBounty escrow program only — we validate every transaction server-side before signing
>
> **What we cannot do:**
> - Transfer your SOL or tokens
> - Withdraw funds from any escrow
> - Sign any transaction outside the `ghbounty_escrow` program
>
> **Revoke any time:** clicking the button below will revoke all server-side signing permissions. Your agent will stop being able to submit PRs until you re-authorize.
>
> `[ Authorize ]`   *State: Not authorized*

Estado post-autorización:

> ### Agent authorization
>
> ✓ **Authorized** — your agent can submit PRs on your behalf
>
> - Wallet: `<pubkey>`
> - Delegated since: `<ISO timestamp>`
>
> `[ Revoke authorization ]`

---

## Testing

### Unit (apps/mcp/tests/)
- Un test por handler (`submissions/list.test.ts`, `submissions/create.test.ts`).
- Mocks de: Privy server SDK, Solana RPC, Supabase client, GitHub API, gas station fetch.
- Cubrir cada row de la tabla de error handling.
- Idempotency: misma call dos veces → mismo `submission_id`.

### Unit (packages/shared/tests/)
- `verify-pr-ownership` — happy path + cada `reason` posible.

### Unit (relayer/tests/)
- Post-check happy + fail (mismatch debe marcar `auto_rejected`).

### Integration (apps/mcp/tests/integration/)
- Profile dev de prueba con wallet delegada (Privy test mode si está disponible; si no, mock the Privy server SDK at the integration layer).
- Flow real contra devnet local (validator-test): submit_pr → submission row en DB → simular relayer pickup → evaluations row → submissions.get devuelve scored.

### Manual smoke test post-deploy
Documentar en `docs/superpowers/runbooks/2026-05-18-sprint-b-smoke.md`:
1. Gaston entra a `/app/credentials`, delega wallet
2. Desde Claude Code conectado a `mcp.ghbounty.com` con la API key de Gaston:
   - `bounties.list` → ver bounty test
   - `submit_pr({ bounty_id, pr_url })` con un PR real propio contra el repo target
   - `submissions.get` polling hasta ver `state='scored'`
3. Validar en Supabase Studio: row en `submissions` con state correcto, row en `evaluations` con score.
4. Validar en Solana Explorer (devnet): cuenta de submission existe en el PDA esperado.

---

## Rollout / migration plan

Cada paso es revertible. Gaston aplica las migrations manualmente (no CI/Vercel) per CLAUDE.md.

1. **Mergear migration Drizzle** (`agent_delegations` table). Gaston: `pnpm db:migrate` a devnet (Supabase prod).
2. **Deploy frontend** con UI de delegación. Aún sin tools nuevas — el botón funciona y persiste el row, pero todavía no hay tools que lo lean.
3. **Deploy `packages/shared/src/github/verify-pr-ownership.ts`**.
4. **Deploy relayer** con post-check. Sin efecto real hasta que existan submissions vía MCP.
5. **Deploy MCP** con: `requireRole` aplicado a tools existentes, `submissions.list`, `requireWalletDelegated`, Privy server SDK integrado. Aún sin `submit_pr`.
6. **Smoke test partial**: Gaston delega su wallet, llama `submissions.list` → verifica respuesta. Llama `whoami` → role check. Llama una tool con la API key de un company test → 403.
7. **Deploy MCP con `submit_pr`**.
8. **Smoke test end-to-end** con un PR real (ver sección Testing).
9. **Update** `docsGaso/Engineering/mcp-state.md` + memory `project_mcp_state_2026_05_18.md`.

---

## Open questions / future work

Cosas que NO entran en Sprint B pero quedan trackeadas:

- **Privy pricing/SLA**: verificar costo de delegated server-signing en plan actual. Gaston a confirmar con Privy fuera de banda. No bloqueante para implementación pero sí para go-live.
- **On-chain ownership check (GHB-182 v2)**: redeploy del programa con oráculo de GitHub identity. Tracked en GHB-182. Sprint B mitiga off-chain.
- **Webhooks vs polling**: si los agentes terminan poleando muy fuerte, considerar webhook outbound (push) en un sprint futuro. MCP spec no lo cubre nativo aún, requiere convención propia.
- **`opus_report_hash` commit on-chain**: hoy queda en ceros. Si queremos integridad criptográfica del scoring, agregar un ix `set_score` con el hash real. Sprint futuro.
- **Tools company-side**: `bounties.create`, `bounties.resolve`, `bounties.cancel`, `submissions.list` company-flavor. Sprint distinto.
- **Multi-chain**: tracked en GHB-192.

---

## Estimación

5-7 días de trabajo focused:

- Día 1: Migration `agent_delegations` + lib `verify-pr-ownership` (compartida).
- Día 2: Frontend `/app/credentials` con consent screen + endpoint sync.
- Día 3: MCP `submissions.list` + role guards + delegation guard + Privy server SDK wrapper.
- Día 4: MCP `submissions.create` (build tx + Privy signing + gas station + idempotency).
- Día 5: Relayer post-check + tests cross-paquete.
- Día 6: Integration tests + smoke test partial.
- Día 7: Smoke test end-to-end + docs + state update.

Buffer ya incluido.
