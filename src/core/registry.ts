import type { Provider } from "./provider.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export class ProviderRegistry {
  private providers: Provider[] = [];
  add(p: Provider) { this.providers.push(p); }
  registerAll(server: McpServer) {
    for (const p of this.providers) p.registerAll(server);
  }
  mountAllOAuth(app: any) {
    for (const p of this.providers) p.mountOAuth?.(app);
  }
  list() { return this.providers; }
  listTools() { return this.providers.flatMap(p => p.listTools()); }
}
