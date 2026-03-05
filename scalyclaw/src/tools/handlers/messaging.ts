import { log } from '@scalyclaw/shared/core/logger.js';
import { stat } from 'node:fs/promises';
import { resolveFilePath } from '../../core/workspace.js';
import { publishProgress } from '../../queue/progress.js';
import type { ToolContext } from '../tool-registry.js';

export async function handleSendMessage(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const channelId = (input.channelId as string) || ctx.channelId;
  const text = input.text as string;
  if (!text) return JSON.stringify({ error: 'Missing required field: text' });
  await ctx.sendToChannel(channelId, text);
  return JSON.stringify({ sent: true, channelId });
}

export async function handleSendFile(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const filePath = input.path as string;
  const caption = input.caption as string | undefined;

  if (!filePath) {
    return JSON.stringify({ error: 'Missing required field: path' });
  }

  log('debug', 'send_file', { filePath, caption, channelId: ctx.channelId });

  try {
    const resolvedPath = resolveFilePath(filePath);
    const fileStat = await stat(resolvedPath);

    // Dedup: skip if this exact file (path + size + mtime) was already sent in this session
    const dedupKey = `${filePath}:${fileStat.size}:${fileStat.mtimeMs}`;
    if (ctx.sentFiles.has(dedupKey)) {
      log('debug', 'send_file dedup — identical file already sent', { filePath, channelId: ctx.channelId });
      return JSON.stringify({ sent: true, path: filePath, note: 'File was already sent' });
    }

    const { getRedis } = await import('@scalyclaw/shared/core/redis.js');
    await publishProgress(getRedis(), ctx.channelId, {
      jobId: 'file-send',
      type: 'complete',
      filePath,
      caption,
    });
    ctx.sentFiles.add(dedupKey);
    return JSON.stringify({ sent: true, path: filePath });
  } catch (err) {
    log('error', 'send_file failed', { error: String(err), filePath });
    return JSON.stringify({ error: `Failed to send file: ${String(err)}` });
  }
}
