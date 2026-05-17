// Public MCP endpoint. The dynamic route segment `[transport]` is
// `mcp` for the Streamable HTTP transport (the only one we support).
// Tools are registered by `lib/tools/register.ts`; this file is just
// the framework shell.
//
// SSE is intentionally disabled (GHB-189). It was removed from the MCP
// spec on 2025-03-26 (see mcp-handler types) and `mcp-handler`'s SSE
// handler hard-requires a TCP Redis URL — without it the handler
// throws before flushing any HTTP headers, which surfaces to clients
// as a 0-byte connection that hangs until they time out. With
// `disableSse: true` the same path returns a clean 404 instead.

import { createMcpHandler } from "mcp-handler";
import { registerAllTools } from "@/lib/tools/register";

const handler = createMcpHandler(
  async (server) => {
    await registerAllTools(server);
  },
  {
    capabilities: {
      tools: {},
    },
  },
  {
    basePath: "/api/mcp",
    disableSse: true,
  }
);

export { handler as GET, handler as POST, handler as DELETE };

export const dynamic = "force-dynamic";
export const maxDuration = 60;
