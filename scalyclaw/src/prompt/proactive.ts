import type { Message } from '../core/db.js';

export interface ProactivePromptContext {
  identity: string;
  messages: Message[];
  pendingResults: Message[];
  currentTime: string;
}

export function buildProactivePrompt(ctx: ProactivePromptContext): { system: string; user: string } {
  const system = `You are a proactive engagement module. Your personality and identity:

${ctx.identity}

Rules:
- 1-3 sentences maximum
- Be concise and natural
- No greetings like "Hey!" or "Hi there!"
- No meta-talk about being proactive or checking in
- Do not apologize
- If there are pending results (tasks, reminders), summarize them naturally
- If the conversation had unfinished topics, follow up on them
- If there is nothing specific or meaningful to say, respond with exactly: [SKIP]
- Never fabricate information — only reference what you see in the context`;

  const parts: string[] = [];
  parts.push(`Current time: ${ctx.currentTime}`);

  if (ctx.messages.length > 0) {
    const formatted = ctx.messages.map(m => `[${m.role}] ${m.content}`).join('\n');
    parts.push(`Recent conversation:\n${formatted}`);
  } else {
    parts.push('No prior conversation in this channel.');
  }

  if (ctx.pendingResults.length > 0) {
    const formatted = ctx.pendingResults.map(m => {
      const meta = m.metadata ? JSON.parse(m.metadata) : {};
      return `[${meta.source ?? 'result'}] ${m.content}`;
    }).join('\n');
    parts.push(`Pending results (delivered while user was away):\n${formatted}`);
  }

  parts.push('Generate a proactive follow-up message, or [SKIP] if nothing meaningful to say.');

  return { system, user: parts.join('\n\n') };
}
