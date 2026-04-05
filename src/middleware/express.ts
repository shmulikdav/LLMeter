import { MeterOptions, ExpressMiddlewareOptions } from '../types';
import { meter } from '../index';

/**
 * Creates Express middleware that attaches `req.meter()` and `req.meterStream()`
 * to every request, pre-filled with feature, userId, and sessionId.
 *
 * @example
 * ```typescript
 * import { createExpressMiddleware } from 'llm-cost-meter';
 *
 * app.post('/api/chat', createExpressMiddleware({ feature: 'chat' }), async (req, res) => {
 *   const response = await req.meter(() =>
 *     client.messages.create({ model: 'claude-sonnet-4-20250514', ... })
 *   );
 *   res.json(response);
 * });
 * ```
 */
export function createExpressMiddleware(config: ExpressMiddlewareOptions) {
  return (req: any, _res: any, next: any) => {
    const userId = config.extractUserId?.(req) ?? req.user?.id;
    const sessionId = config.extractSessionId?.(req) ?? req.sessionID ?? req.sessionId;

    req.meter = <T>(fn: () => Promise<T>, options: Partial<MeterOptions> = {}) =>
      meter(fn, {
        feature: config.feature,
        userId,
        sessionId,
        env: config.env,
        tags: config.tags,
        ...options,
      });

    next();
  };
}
