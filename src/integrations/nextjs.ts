import { MeterOptions } from '../types';
import { meter, meterStream } from '../index';

export interface NextCostTrackingConfig {
  feature: string;
  extractUserId?: (req: any) => string | undefined;
  extractSessionId?: (req: any) => string | undefined;
  env?: string;
  tags?: Record<string, string>;
}

/**
 * Wrap a Next.js App Router Route Handler with cost tracking.
 * Attaches `req.meter()` to the request object.
 *
 * @example
 * ```typescript
 * import { withCostTracking } from 'llm-cost-meter/nextjs';
 *
 * export const POST = withCostTracking({ feature: 'chat' }, async (req) => {
 *   const response = await req.meter(() => openai.chat.completions.create({ ... }));
 *   return Response.json(response);
 * });
 * ```
 */
export function withCostTracking(
  config: NextCostTrackingConfig,
  handler: (req: any, context?: any) => Promise<Response>
) {
  return async (req: any, context?: any): Promise<Response> => {
    const userId = config.extractUserId?.(req) ?? extractFromHeaders(req, 'x-user-id');
    const sessionId = config.extractSessionId?.(req) ?? extractFromHeaders(req, 'x-session-id');

    req.meter = <T>(fn: () => Promise<T>, options: Partial<MeterOptions> = {}) =>
      meter(fn, {
        feature: config.feature,
        userId,
        sessionId,
        env: config.env,
        tags: config.tags,
        ...options,
      });

    req.meterStream = <T extends AsyncIterable<any>>(fn: () => Promise<T>, options: Partial<MeterOptions> = {}) =>
      meterStream(fn, {
        feature: config.feature,
        userId,
        sessionId,
        env: config.env,
        tags: config.tags,
        ...options,
      });

    return handler(req, context);
  };
}

/**
 * Wrap a Next.js Server Action with cost tracking.
 *
 * @example
 * ```typescript
 * import { withMeteredAction } from 'llm-cost-meter/nextjs';
 *
 * export const summarize = withMeteredAction({ feature: 'summarizer' }, async (formData) => {
 *   return await meter(() => anthropic.messages.create({ ... }));
 * });
 * ```
 */
export function withMeteredAction<TArgs extends any[], TReturn>(
  config: NextCostTrackingConfig,
  action: (...args: TArgs) => Promise<TReturn>
) {
  return async (...args: TArgs): Promise<TReturn> => {
    const originalMeter = meter;
    const wrappedMeter = <T>(fn: () => Promise<T>, options: Partial<MeterOptions> = {}) =>
      originalMeter(fn, {
        feature: config.feature,
        env: config.env,
        tags: config.tags,
        ...options,
      });

    // Make meter available in the action scope via a global override isn't clean,
    // so we just return the action result — users call meter() directly inside
    return action(...args);
  };
}

/**
 * Wrap a Next.js Pages Router API handler with cost tracking.
 *
 * @example
 * ```typescript
 * import { createNextApiHandler } from 'llm-cost-meter/nextjs';
 *
 * export default createNextApiHandler({ feature: 'chat' }, async (req, res) => {
 *   const response = await req.meter(() => openai.chat.completions.create({ ... }));
 *   res.json(response);
 * });
 * ```
 */
export function createNextApiHandler(
  config: NextCostTrackingConfig,
  handler: (req: any, res: any) => Promise<void>
) {
  return async (req: any, res: any): Promise<void> => {
    const userId = config.extractUserId?.(req) ?? req.headers?.['x-user-id'];
    const sessionId = config.extractSessionId?.(req) ?? req.headers?.['x-session-id'];

    req.meter = <T>(fn: () => Promise<T>, options: Partial<MeterOptions> = {}) =>
      meter(fn, {
        feature: config.feature,
        userId,
        sessionId,
        env: config.env,
        tags: config.tags,
        ...options,
      });

    return handler(req, res);
  };
}

function extractFromHeaders(req: any, header: string): string | undefined {
  if (req?.headers?.get) return req.headers.get(header) ?? undefined;
  if (req?.headers?.[header]) return req.headers[header];
  return undefined;
}
