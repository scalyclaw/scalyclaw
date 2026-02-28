import OpenAI from 'openai';
import type { ModelProvider, ModelResponse } from '../provider.js';
import { log } from '@scalyclaw/shared/core/logger.js';

const BASE_URL = 'https://api.minimax.io/v1';

export function createMiniMaxProvider(apiKey: string, baseUrl?: string): ModelProvider {
  const client = new OpenAI({ apiKey, baseURL: baseUrl ?? BASE_URL });

  return {
    id: 'minimax',

    async chat({ model, systemPrompt, messages, tools, maxTokens, temperature, reasoningEnabled: _reasoningEnabled, signal }): Promise<ModelResponse> {
      const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...messages.map((m): OpenAI.Chat.Completions.ChatCompletionMessageParam => {
          if (m.role === 'tool') {
            return { role: 'tool', content: m.content, tool_call_id: m.tool_call_id || '' };
          }
          if (m.role === 'assistant') {
            if (m.tool_calls && m.tool_calls.length > 0) {
              return {
                role: 'assistant' as const,
                content: m.content || null,
                tool_calls: m.tool_calls.map(tc => ({
                  id: tc.id,
                  type: 'function' as const,
                  function: { name: tc.name, arguments: JSON.stringify(tc.input) },
                })),
              };
            }
            return { role: 'assistant', content: m.content };
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

      log('debug', 'MiniMax API call', { model, messageCount: openaiMessages.length, toolCount: openaiTools?.length ?? 0, maxTokens, temperature });
      const startTime = Date.now();
      const response = await client.chat.completions.create({
        model,
        messages: openaiMessages,
        tools: openaiTools,
        max_tokens: maxTokens ?? 8192,
        temperature: temperature ?? 0.7,
      }, { signal });
      log('debug', 'MiniMax API response', { model, durationMs: Date.now() - startTime, finishReason: response.choices[0]?.finish_reason, promptTokens: response.usage?.prompt_tokens, completionTokens: response.usage?.completion_tokens });

      const choice = response.choices[0];
      // Strip <think>...</think> reasoning tags from MiniMax responses
      const content = (choice.message.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
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

      const stopReason = choice.finish_reason === 'tool_calls' ? 'tool_use'
        : choice.finish_reason === 'length' ? 'max_tokens'
        : 'end_turn';

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
