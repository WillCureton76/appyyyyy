import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z, ZodTypeAny } from "zod";
import type { UsageStore } from "../storage/usageStore.js";

export type ToolSpec = {
  name: string;
  title: string;
  description: string;
  inputSchema: ZodTypeAny;
handler: (args: any) => Promise<CallToolResult>;};
export abstract class Provider {
  readonly name: string;
  protected tools: ToolSpec[] = [];
  protected usage?: UsageStore;
  constructor(name: string, usage?: UsageStore) {
    this.name = name;
    this.usage = usage;
  }
  toolFullName(t: ToolSpec) { return `${this.name}.${t.name}`; }

  registerTool(spec: ToolSpec) { this.tools.push(spec); }

  listTools() {
    return this.tools.map(t => ({
      name: this.toolFullName(t),
      description: t.description,
      inputSchema: t.inputSchema._def
    }));
  }

  mountOAuth?(app: any): void;

  registerAll(server: McpServer) {
    for (const t of this.tools) {
      server.registerTool(this.toolFullName(t), {
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema
      }, async (args) => {
        const start = Date.now();
        try {
          const out = await t.handler(args);
          await this.usage?.log({ provider: this.name, tool_name: t.name, success: true, latency_ms: Date.now()-start });
          return out;
        } catch (e: any) {
          await this.usage?.log({ provider: this.name, tool_name: t.name, success: false, latency_ms: Date.now()-start, error_message: e?.message || String(e) });
          throw e;
        }
      });
    }
  }
}
