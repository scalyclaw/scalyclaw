import OpenAI from 'openai';
import type { ModelProvider, ModelResponse } from '../provider.js';
import { log } from '@scalyclaw/shared/core/logger.js';

const BASE_URL = 'http://localhost:1234/v1';

/**
 * Strip local-model artifacts from content.
 * Handles: <think> tags, ChatML tokens (<|im_start|>, <|im_end|>, etc.),
 * and hallucinated multi-turn continuations that Qwen/DeepSeek/etc. emit.
 */
function cleanContent(raw: string): string {
  // 1. Strip <think>...</think> reasoning tags (DeepSeek R1, Qwen3 emit them)
  let text = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
  // 2. Truncate at first <|im_end|> — everything after is hallucinated turns
  const imEndIdx = text.indexOf('<|im_end|>');
  if (imEndIdx !== -1) text = text.slice(0, imEndIdx);
  // 3. Strip any remaining special tokens (<|...|> format covers im_start, im_end, endoftext, etc.)
  text = text.replace(/<\|[^|]*\|>/g, '').trim();
  return text;
}

export function createLMStudioProvider(baseUrl?: string): ModelProvider {
  const client = new OpenAI({ apiKey: 'lm-studio', baseURL: baseUrl ?? BASE_URL });

  return {
    id: 'lmstudio',

    async chat({ model, systemPrompt, messages, tools, maxTokens, temperature, reasoningEnabled: _reasoningEnabled, signal }): Promise<ModelResponse> {
      const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...messages.map((m): OpenAI.Chat.Completions.ChatCompletionMessageParam => {
          if (m.role === 'tool') {
            return { role: 'tool', content: m.content, tool_call_id: m.tool_call_id || '' };
          }
          if (m.role === 'assistant') {
            // Clean historical assistant messages — previous responses may contain
            // leaked ChatML tokens or <think> tags stored before cleanup was added.
            const cleaned = cleanContent(m.content || '');
            if (m.tool_calls && m.tool_calls.length > 0) {
              return {
                role: 'assistant' as const,
                content: cleaned || null,
                tool_calls: m.tool_calls.map(tc => ({
                  id: tc.id,
                  type: 'function' as const,
                  function: { name: tc.name, arguments: JSON.stringify(tc.input) },
                })),
              };
            }
            return { role: 'assistant', content: cleaned };
          }
          return { role: 'user', content: m.content };
        }),
      ];

      const openaiTools = tools?.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));

      log('debug', 'LM Studio API call', { model, messageCount: openaiMessages.length, toolCount: openaiTools?.length ?? 0, maxTokens, temperature });
      const startTime = Date.now();
      const response = await client.chat.completions.create({
        model,
        messages: openaiMessages,
        tools: openaiTools,
        max_tokens: maxTokens ?? 8192,
        temperature: temperature ?? 0.7,
      }, { signal });
      log('debug', 'LM Studio API response', { model, durationMs: Date.now() - startTime, finishReason: response.choices[0]?.finish_reason, promptTokens: response.usage?.prompt_tokens, completionTokens: response.usage?.completion_tokens });

      const choice = response.choices[0];
      const content = cleanContent(choice.message.content || '');
      const toolCalls: ModelResponse['toolCalls'] = [];

      if (choice.message.tool_calls) {
        for (const tc of choice.message.tool_calls) {
          toolCalls.push({
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
          });
        }
      }

      let stopReason: ModelResponse['stopReason'];
      if (choice.finish_reason === 'tool_calls' || toolCalls.length > 0) {
        stopReason = 'tool_use';
      } else if (choice.finish_reason === 'length') {
        stopReason = 'max_tokens';
      } else {
        stopReason = 'end_turn';
      }

      if (toolCalls.length > 0 && choice.finish_reason !== 'tool_calls') {
        log('warn', 'LM Studio finish_reason/tool_calls mismatch', {
          finishReason: choice.finish_reason,
          toolCallCount: toolCalls.length,
          toolNames: toolCalls.map(tc => tc.name),
        });
      }

      return {
        content,
        toolCalls,
        stopReason,
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
      };
    },

    async ping(model: string): Promise<boolean> {
      try {
        await client.chat.completions.create({
          model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}
