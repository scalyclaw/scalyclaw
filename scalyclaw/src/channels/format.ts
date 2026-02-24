// Per-channel Markdown formatters
// Converts GitHub-flavored Markdown (GFM) to each channel's native format.
// All formatters use a protect-then-transform pattern:
//   1. Extract code blocks/inline code → placeholders
//   2. Apply formatting transforms on remaining text
//   3. Restore code blocks with channel-specific rendering

interface CodeBlock {
  lang: string;
  code: string;
  inline: boolean;
}

type CodeRenderer = (block: CodeBlock) => string;

const PLACEHOLDER_PREFIX = '\x00CB';
const PLACEHOLDER_SUFFIX = '\x00';

function extractCodeBlocks(text: string): { cleaned: string; blocks: Map<string, CodeBlock> } {
  const blocks = new Map<string, CodeBlock>();
  let counter = 0;

  // Extract fenced code blocks first (```...```)
  let cleaned = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang: string, code: string) => {
    const id = `${PLACEHOLDER_PREFIX}${counter++}${PLACEHOLDER_SUFFIX}`;
    blocks.set(id, { lang, code: code.replace(/\n$/, ''), inline: false });
    return id;
  });

  // Extract inline code (`...`) — but not inside placeholders
  cleaned = cleaned.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const id = `${PLACEHOLDER_PREFIX}${counter++}${PLACEHOLDER_SUFFIX}`;
    blocks.set(id, { lang: '', code, inline: true });
    return id;
  });

  return { cleaned, blocks };
}

function restoreCodeBlocks(text: string, blocks: Map<string, CodeBlock>, renderer: CodeRenderer): string {
  let result = text;
  for (const [id, block] of blocks) {
    result = result.replace(id, renderer(block));
  }
  return result;
}

// ── Telegram HTML ───────────────────────────────────────────────────────

export function formatTelegramHTML(markdown: string): string {
  const { cleaned, blocks } = extractCodeBlocks(markdown);

  let text = cleaned;

  // Escape HTML entities in non-code text
  text = text.replace(/&/g, '&amp;');
  text = text.replace(/</g, '&lt;');
  text = text.replace(/>/g, '&gt;');

  // Bold+Italic (must come before bold and italic)
  text = text.replace(/\*{3}(.+?)\*{3}/g, '<b><i>$1</i></b>');
  // Bold
  text = text.replace(/\*{2}(.+?)\*{2}/g, '<b>$1</b>');
  // Italic (single * not preceded/followed by *)
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<i>$1</i>');
  // Strikethrough
  text = text.replace(/~~(.+?)~~/g, '<s>$1</s>');
  // Images (before links — same syntax with !)
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // Headings → bold
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');
  // Horizontal rule
  text = text.replace(/^-{3,}$/gm, '———');
  // Blockquotes — strip the > marker (Telegram HTML has no blockquote element worth using inline)
  text = text.replace(/^&gt;\s?(.*)$/gm, '$1');

  return restoreCodeBlocks(text, blocks, (block) => {
    if (block.inline) return `<code>${escapeHTML(block.code)}</code>`;
    return `<pre>${escapeHTML(block.code)}</pre>`;
  });
}

function escapeHTML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Slack mrkdwn ────────────────────────────────────────────────────────

export function formatSlack(markdown: string): string {
  const { cleaned, blocks } = extractCodeBlocks(markdown);

  let text = cleaned;

  // Bold+Italic
  text = text.replace(/\*{3}(.+?)\*{3}/g, '*_$1_*');
  // Bold
  text = text.replace(/\*{2}(.+?)\*{2}/g, '*$1*');
  // Italic (GFM single * → Slack _)
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '_$1_');
  // Strikethrough
  text = text.replace(/~~(.+?)~~/g, '~$1~');
  // Images (before links)
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<$2|$1>');
  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');
  // Headings → bold
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
  // Horizontal rule
  text = text.replace(/^-{3,}$/gm, '———');
  // Blockquotes — Slack uses &gt;
  text = text.replace(/^>\s?(.*)$/gm, '&gt; $1');

  return restoreCodeBlocks(text, blocks, (block) => {
    if (block.inline) return `\`${block.code}\``;
    return `\`\`\`\n${block.code}\n\`\`\``;
  });
}

// ── WhatsApp markup ─────────────────────────────────────────────────────

export function formatWhatsApp(markdown: string): string {
  const { cleaned, blocks } = extractCodeBlocks(markdown);

  let text = cleaned;

  // Bold+Italic
  text = text.replace(/\*{3}(.+?)\*{3}/g, '*_$1_*');
  // Bold (GFM ** → WhatsApp *)
  text = text.replace(/\*{2}(.+?)\*{2}/g, '*$1*');
  // Italic (GFM single * → WhatsApp _)
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '_$1_');
  // Strikethrough
  text = text.replace(/~~(.+?)~~/g, '~$1~');
  // Images (before links)
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1 ($2)');
  // Links (WhatsApp has no link syntax)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  // Headings → bold
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
  // Horizontal rule
  text = text.replace(/^-{3,}$/gm, '———');

  return restoreCodeBlocks(text, blocks, (block) => {
    if (block.inline) return `\`${block.code}\``;
    return `\`\`\`\n${block.code}\n\`\`\``;
  });
}

// ── Plain text (Signal) ─────────────────────────────────────────────────

export function formatPlainText(markdown: string): string {
  const { cleaned, blocks } = extractCodeBlocks(markdown);

  let text = cleaned;

  // Strip bold+italic markers
  text = text.replace(/\*{3}(.+?)\*{3}/g, '$1');
  // Strip bold markers
  text = text.replace(/\*{2}(.+?)\*{2}/g, '$1');
  // Strip italic markers
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1');
  // Strip strikethrough markers
  text = text.replace(/~~(.+?)~~/g, '$1');
  // Images (before links)
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1 ($2)');
  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  // Strip heading markers
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '$1');
  // Horizontal rule
  text = text.replace(/^-{3,}$/gm, '———');

  return restoreCodeBlocks(text, blocks, (block) => {
    if (block.inline) return block.code;
    return block.code;
  });
}
