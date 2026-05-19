# Sprint B smoke test runbook (2026-05-18)

End-to-end manual verification of `submissions.create` after deploy. Run by a human (Gaston) post-merge, post-deploy.

## Pre-flight

- [ ] Migration 0026 applied to devnet Supabase (`pnpm db:migrate` — see Task 16 of the plan).
- [ ] MCP deploy includes commits up to (and including) the `submissions.create` task.
- [ ] Relayer deploy includes the ownership pre-check.
- [ ] Frontend deploy includes the `AgentDelegationCard`.
- [ ] `PRIVY_APP_ID` / `PRIVY_APP_SECRET` set on the MCP env (Vercel project).
- [ ] `GITHUB_TOKEN` set on both MCP and relayer envs (recommended for higher GitHub rate limits).
- [ ] Gaston has an active dev profile in devnet with a linked GitHub handle.

## Steps

### 1. Delegate the wallet

Log into `/app/credentials` as Gaston (dev role). Click "Authorize" in the new card. Confirm in Privy. Verify in Supabase Studio that `agent_delegations` has a row with `revoked_at IS NULL` for your `user_id`.

### 2. Verify `submissions.list` (sanity check)

Hit the MCP from Claude Code (or curl):

```bash
curl -sS -X POST https://mcp.ghbounty.com/api/mcp/mcp \
  -H "Authorization: Bearer $GHB_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"submissions.list","arguments":{}}}'
```

Expected: `{ items: [...] }` (possibly empty pre-test).

### 3. Open a real PR

Against the bounty's target repo, using Gaston's GitHub account.

### 4. Call `submissions.create`

```bash
curl -sS -X POST https://mcp.ghbounty.com/api/mcp/mcp \
  -H "Authorization: Bearer $GHB_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"submissions.create",
                 "arguments":{
                   "bounty_id":"<test-bounty-uuid>",
                   "pr_url":"https://github.com/<owner>/<repo>/pull/<N>"}}}'
```

Expected: `{ submission_id, status: "pending", tx_signature, submission_pda }`.

### 5. Verify on-chain

Check Solana Explorer (devnet) for the tx signature. Expect a `submit_solution` invocation in the program.

### 6. Wait for relayer

~30-60s. Poll `submissions.get`:

```bash
curl -sS -X POST https://mcp.ghbounty.com/api/mcp/mcp \
  -H "Authorization: Bearer $GHB_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"submissions.get",
                 "arguments":{"submission_id":"<from step 4>"}}}'
```

Expected: `state: "scored"` with a numeric `score`.

### 7. Negative test — wrong PR author

Submit a PR URL owned by someone else against another bounty. Expect:
```json
{"error": {"code": "Forbidden", "message": "PR ownership check failed: author_mismatch"}}
```

### 8. Negative test — revoke and try again

Revoke the delegation from `/app/credentials`. Call `submissions.create` again. Expect:
```json
{"error": {"code": "Forbidden", "message": "Wallet delegation required — visit /app/credentials to authorize."}}
```

### 9. Negative test — role gating

If you have a company-role API key handy, call `submissions.create` with it. Expect:
```json
{"error": {"code": "Forbidden", "message": "This tool requires `dev` role."}}
```

### 10. Idempotency check

Call `submissions.create` again with the SAME `bounty_id + pr_url` as step 4. Expect:
```json
{"submission_id": "<same id as step 4>", "status": "<current state>", "idempotent": true}
```

## On failure

If any step errors:
- Inspect MCP logs (Vercel dashboard) — they include structured tags for `submissions.create`.
- Inspect relayer logs (process supervisor) — look for `ownership_check_failed`.
- Inspect Supabase `submissions` row state for the relevant PDA.
- Inspect Supabase `agent_delegations` row for your user_id (should exist, `revoked_at IS NULL` for an active delegation).

## Cleanup

After validating, decide:
- If everything worked: smoke test passes. Update memory `project_mcp_state_2026_05_18.md` (or successor) noting Sprint B is live.
- If something broke: don't roll back the migration unless absolutely necessary (Drizzle migrations are forward-only); patch on the feature branch and re-deploy.
