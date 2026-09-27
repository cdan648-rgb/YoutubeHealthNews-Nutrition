/**
 * OpenRouter client.
 *
 * Three things here are not optional, and each was chosen because the obvious version is
 * silently wrong.
 *
 * 1. `provider: { require_parameters: true }`. Declaring a `response_format` is not enough:
 *    OpenRouter routes to whichever provider serves a model, and a provider that does not
 *    support structured output will happily ignore the schema and return prose. This flag
 *    restricts routing to providers that actually honour the parameters we sent.
 *
 * 2. `finish_reason` must be `stop`. A `length` finish means the JSON was truncated
 *    mid-object. That parses as a schema error, which would send the pipeline down the
 *    "model misunderstood" path when the real fix is a larger token budget.
 *
 * 3. JSON Schema stays plain. `minLength`, `format` and `pattern` support varies by
 *    provider and an unsupported keyword can be rejected outright, so the schema carries
 *    only types, enums, `required` and `additionalProperties: false`. Every length and
 *    content rule is enforced by Zod after the call, where it is also testable.
 *
 * The API key is read from the environment at call time and never logged.
 */
import 'server-only';

import type { z } from 'zod';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export const DEFAULT_MODEL = 'inclusionai/ling-3.0-flash-vl';

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly kind: 'config' | 'network' | 'http' | 'truncated' | 'malformed',
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

export type UsageStats = {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly model: string;
  /** Rough cost in USD, from the published rates for the configured model. */
  readonly estimatedCostUsd: number;
};

/** Published rates for the model, per token. Used only for the cost log. */
const RATES: Record<string, { prompt: number; completion: number }> = {
  'inclusionai/ling-3.0-flash-vl': { prompt: 0.000000021, completion: 0.0000000616 },
  'inclusionai/ling-3.0-flash': { prompt: 0.000000021, completion: 0.000000063 },
};

export type CompletionResult<T> = {
  readonly data: T;
  readonly usage: UsageStats;
  readonly repaired: boolean;
};

export type CompletionRequest<T> = {
  readonly system: string;
  readonly user: string;
  /** Plain JSON Schema — types, enums, required, additionalProperties only. */
  readonly jsonSchema: Record<string, unknown>;
  readonly schemaName: string;
  /** The authority on shape. Enforced after the call, not by the provider. */
  readonly validator: z.ZodType<T>;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly fetchImpl?: typeof fetch;
};

type ChatResponse = {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
  error?: { message?: string };
};

function config(): {
  apiKey: string;
  model: string;
  fallbackModel: string | null;
  referer: string;
} {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (apiKey === undefined || apiKey === '') {
    throw new OpenRouterError(
      'OPENROUTER_API_KEY is not set. It is server-only: never add a NEXT_PUBLIC_ prefix.',
      'config',
      false,
    );
  }
  return {
    apiKey,
    model: process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL,
    fallbackModel: process.env.OPENROUTER_FALLBACK_MODEL ?? null,
    referer: process.env.OPENROUTER_REFERER ?? 'https://example.com',
  };
}

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const rate = RATES[model] ?? RATES[DEFAULT_MODEL];
  if (rate === undefined) return 0;
  return promptTokens * rate.prompt + completionTokens * rate.completion;
}

/**
 * One structured completion, with a single repair attempt.
 *
 * On a schema failure the model is asked again with its own output and the specific Zod
 * errors, which fixes the common case of a missing field far more cheaply than regenerating
 * from scratch. Exactly one retry: a model that cannot satisfy the schema twice is not
 * going to on the third attempt, and the article should fail rather than cost more.
 */
export async function complete<T>(request: CompletionRequest<T>): Promise<CompletionResult<T>> {
  const { apiKey, model, fallbackModel, referer } = config();
  const fetchImpl = request.fetchImpl ?? fetch;

  const messages = [
    { role: 'system', content: request.system },
    { role: 'user', content: request.user },
  ];

  let lastErrors = '';

  for (const attempt of [0, 1] as const) {
    const attemptMessages =
      attempt === 0
        ? messages
        : [
            ...messages,
            { role: 'assistant', content: lastErrors.slice(0, 2000) },
            {
              role: 'user',
              content:
                'Kết quả trước đó không đúng schema. Lỗi cụ thể:\n' +
                lastErrors +
                '\nHãy trả lại JSON đúng schema. Không thêm lời giải thích.',
            },
          ];

    const body = {
      model: attempt === 1 && fallbackModel !== null ? fallbackModel : model,
      messages: attemptMessages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 8000,
      response_format: {
        type: 'json_schema',
        json_schema: { name: request.schemaName, strict: true, schema: request.jsonSchema },
      },
      // Without this, a provider that ignores response_format can serve the request.
      provider: { require_parameters: true },
    };

    let response: Response;
    try {
      response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'http-referer': referer,
          'x-title': 'Suc Khoe Giai Ma',
        },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new OpenRouterError(
        `network failure calling OpenRouter: ${cause instanceof Error ? cause.message : String(cause)}`,
        'network',
        true,
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new OpenRouterError(
        `OpenRouter returned ${response.status}: ${text.slice(0, 300)}`,
        'http',
        response.status === 429 || response.status >= 500,
        response.status,
      );
    }

    const payload = (await response.json()) as ChatResponse;
    if (payload.error?.message !== undefined) {
      throw new OpenRouterError(`OpenRouter error: ${payload.error.message}`, 'http', true);
    }

    const choice = payload.choices?.[0];
    const content = choice?.message?.content;

    // A truncated response is a budget problem, not a comprehension problem, and must not
    // be reported as a schema failure.
    if (choice?.finish_reason === 'length') {
      throw new OpenRouterError(
        'model output was truncated (finish_reason=length); raise max_tokens',
        'truncated',
        true,
      );
    }
    if (content === undefined || content.trim() === '') {
      throw new OpenRouterError('model returned an empty response', 'malformed', true);
    }

    const usage: UsageStats = {
      promptTokens: payload.usage?.prompt_tokens ?? 0,
      completionTokens: payload.usage?.completion_tokens ?? 0,
      model: payload.model ?? body.model,
      estimatedCostUsd: estimateCost(
        payload.model ?? body.model,
        payload.usage?.prompt_tokens ?? 0,
        payload.usage?.completion_tokens ?? 0,
      ),
    };

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(content);
    } catch {
      lastErrors = `Không phải JSON hợp lệ: ${content.slice(0, 400)}`;
      if (attempt === 1) {
        throw new OpenRouterError(
          'model output was not valid JSON after one repair attempt',
          'malformed',
          false,
        );
      }
      continue;
    }

    const validated = request.validator.safeParse(parsedJson);
    if (validated.success) {
      return { data: validated.data, usage, repaired: attempt === 1 };
    }

    lastErrors = validated.error.issues
      .slice(0, 12)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    if (attempt === 1) {
      throw new OpenRouterError(
        `model output failed validation after one repair attempt:\n${lastErrors}`,
        'malformed',
        false,
      );
    }
  }

  // Unreachable: both attempts either return or throw.
  throw new OpenRouterError('exhausted completion attempts', 'malformed', false);
}
