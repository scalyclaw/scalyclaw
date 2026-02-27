import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { McpServerConfig } from '../core/config.js';
import type { ToolDefinition } from '../models/provider.js';
import { log } from '@scalyclaw/shared/core/logger.js';

interface McpConnection {
  id: string;
  config: McpServerConfig;
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport;
  tools: ToolDefinition[];
  status: 'connected' | 'disconnected' | 'error';
  error?: string;
}

const connections = new Map<string, McpConnection>();
const toolLookup = new Map<string, { serverId: string; toolName: string }>();

function toolPrefix(serverId: string, toolName: string): string {
  return `mcp_${serverId}_${toolName}`;
}

function detectTransport(config: McpServerConfig): 'stdio' | 'http' | 'sse' {
  if (config.transport) return config.transport;
  if (config.command) return 'stdio';
  if (config.url) {
    return config.url.endsWith('/sse') ? 'sse' : 'http';
  }
  throw new Error('Cannot detect transport: provide command (stdio) or url (http/sse)');
}

async function connectServer(id: string, config: McpServerConfig): Promise<void> {
  if (config.enabled === false) return;

  const transport_type = detectTransport(config);
  const client = new Client({ name: 'scalyclaw', version: '1.0.0' });

  let transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport;
  switch (transport_type) {
    case 'stdio': {
      if (!config.command) {
        log('warn', `MCP server "${id}" detected as stdio but no command — skipping`);
        return;
      }
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
        cwd: config.cwd,
      });
      break;
    }
    case 'sse': {
      if (!config.url) {
        log('warn', `MCP server "${id}" detected as sse but no url — skipping`);
        return;
      }
      transport = new SSEClientTransport(
        new URL(config.url),
        config.headers ? { requestInit: { headers: config.headers } } : undefined,
      );
      break;
    }
    case 'http': {
      if (!config.url) {
        log('warn', `MCP server "${id}" detected as http but no url — skipping`);
        return;
      }
      transport = new StreamableHTTPClientTransport(
        new URL(config.url),
        config.headers ? { requestInit: { headers: config.headers } } : undefined,
      );
      break;
    }
  }

  const conn: McpConnection = {
    id,
    config,
    client,
    transport,
    tools: [],
    status: 'disconnected',
  };

  try {
    await client.connect(transport);
    conn.status = 'connected';

    // Discover tools
    const result = await client.listTools();
    const discovered = result.tools ?? [];
    for (const tool of discovered) {
      const prefixed = toolPrefix(id, tool.name);
      const def: ToolDefinition = {
        name: prefixed,
        description: `[MCP: ${id}] ${tool.description ?? ''}`,
        input_schema: (tool.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
      };
      conn.tools.push(def);
      toolLookup.set(prefixed, { serverId: id, toolName: tool.name });
    }

    connections.set(id, conn);
    log('info', `MCP server "${id}" connected`, { tools: discovered.length });
  } catch (err) {
    conn.status = 'error';
    conn.error = String(err);
    connections.set(id, conn);
    log('error', `MCP server "${id}" failed to connect`, { error: String(err) });
  }
}

async function disconnectServer(id: string): Promise<void> {
  const conn = connections.get(id);
  if (!conn) return;

  // Remove tool lookup entries
  for (const tool of conn.tools) {
    toolLookup.delete(tool.name);
  }

  try {
    await conn.client.close();
  } catch (err) {
    log('warn', `Error closing MCP server "${id}"`, { error: String(err) });
  }

  connections.delete(id);
  log('info', `MCP server "${id}" disconnected`);
}

export async function connectAll(servers: Record<string, McpServerConfig>): Promise<void> {
  const entries = Object.entries(servers).filter(([, cfg]) => cfg.enabled !== false);
  if (entries.length === 0) return;

  log('info', `Connecting to ${entries.length} MCP server(s)...`);
  await Promise.all(entries.map(([id, cfg]) => connectServer(id, cfg)));
}

export async function disconnectAll(): Promise<void> {
  const ids = [...connections.keys()];
  await Promise.all(ids.map(disconnectServer));
}

export async function reloadServers(servers: Record<string, McpServerConfig>): Promise<void> {
  const currentIds = new Set(connections.keys());
  const newIds = new Set(Object.keys(servers));

  // Disconnect removed servers
  for (const id of currentIds) {
    if (!newIds.has(id)) {
      await disconnectServer(id);
    }
  }

  // Connect new or changed servers
  for (const [id, cfg] of Object.entries(servers)) {
    const existing = connections.get(id);
    if (existing) {
      const changed =
        existing.config.transport !== cfg.transport ||
        existing.config.command !== cfg.command ||
        existing.config.url !== cfg.url ||
        existing.config.cwd !== cfg.cwd ||
        existing.config.enabled !== cfg.enabled ||
        JSON.stringify(existing.config.args) !== JSON.stringify(cfg.args) ||
        JSON.stringify(existing.config.env) !== JSON.stringify(cfg.env) ||
        JSON.stringify(existing.config.headers) !== JSON.stringify(cfg.headers);

      if (changed) {
        await disconnectServer(id);
        await connectServer(id, cfg);
      }
    } else {
      await connectServer(id, cfg);
    }
  }
}

export function getMcpTools(): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  for (const conn of connections.values()) {
    if (conn.status === 'connected') {
      tools.push(...conn.tools);
    }
  }
  return tools;
}

/** Get MCP tools for a specific set of server IDs */
export function getMcpToolsForServers(serverIds: string[]): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  for (const id of serverIds) {
    const conn = connections.get(id);
    if (conn && conn.status === 'connected') {
      tools.push(...conn.tools);
    }
  }
  return tools;
}

export function getMcpToolNames(): Set<string> {
  return new Set(toolLookup.keys());
}

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  const entry = toolLookup.get(name);
  if (!entry) {
    return JSON.stringify({ error: `Unknown MCP tool: ${name}` });
  }

  const conn = connections.get(entry.serverId);
  if (!conn || conn.status !== 'connected') {
    return JSON.stringify({ error: `MCP server "${entry.serverId}" is not connected` });
  }

  try {
    const result = await conn.client.callTool({ name: entry.toolName, arguments: args });
    // Flatten content array into a single string
    if (Array.isArray(result.content)) {
      const texts = result.content
        .filter((c): c is { type: string; text: string } => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text);
      if (texts.length > 0) return texts.join('\n');
    }
    return JSON.stringify(result.content ?? result);
  } catch (err) {
    log('error', `MCP tool call failed: ${name}`, { error: String(err) });
    return JSON.stringify({ error: `MCP tool "${name}" failed: ${String(err)}` });
  }
}

export async function reconnectServer(id: string, config: McpServerConfig): Promise<void> {
  await disconnectServer(id);
  await connectServer(id, config);
}

export function getConnectionStatuses(): Array<{
  id: string;
  transport: string;
  status: string;
  error?: string;
  toolCount: number;
  tools: Array<{ name: string; description: string }>;
}> {
  return [...connections.values()].map((conn) => ({
    id: conn.id,
    transport: detectTransport(conn.config),
    status: conn.status,
    error: conn.error,
    toolCount: conn.tools.length,
    tools: conn.tools.map((t) => ({ name: t.name, description: t.description })),
  }));
}
