// apps/mcp/lib/config.ts
// Shared runtime-config helpers that read from process.env.

export function getChainId(): string {
  const chainId = process.env.CHAIN_ID;
  if (!chainId) {
    throw new Error("CHAIN_ID must be set");
  }
  return chainId;
}

export function getProgramAddress(): string {
  const addr = process.env.GHBOUNTY_PROGRAM_ADDRESS;
  if (!addr) {
    throw new Error("GHBOUNTY_PROGRAM_ADDRESS must be set");
  }
  return addr;
}
