import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWhoami } from "./whoami";
import { registerBountiesList } from "./bounties/list";
import { registerBountiesGet } from "./bounties/get";
import { registerSubmissionsGet } from "./submissions/get";
import { registerSubmissionsList } from "./submissions/list";

export async function registerAllTools(server: McpServer): Promise<void> {
  registerWhoami(server);
  registerBountiesList(server);
  registerBountiesGet(server);
  registerSubmissionsGet(server);
  registerSubmissionsList(server);
}
