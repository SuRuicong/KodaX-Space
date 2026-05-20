// MCP IPC handlers — FEATURE_036 alpha.1 (read-only).
//
// 仅 mcp.discover——读 ~/.kodax/config.json + ${projectRoot}/.kodax/config.json 的 mcpServers。
// 启停 / 日志 / tool catalog 等需要 KodaX SDK 公开 MCP 管理 API，等 v0.1.7 F039 接磁盘版后做。

import { registerChannel } from './register.js';
import { kodaxHost } from '../kodax/host.js';
import { discoverMcpServers } from '../mcp/config-reader.js';

export function registerMcpChannels(): void {
  registerChannel('mcp.discover', async (input) => {
    const session = kodaxHost.get(input.sessionId);
    if (!session) {
      throw new Error(`session not found: ${input.sessionId}`);
    }
    return discoverMcpServers({ projectRoot: session.projectRoot });
  });
}
