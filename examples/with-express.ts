/**
 * Express.js integration example for llm-cost-meter
 *
 * Shows how to create middleware that automatically tracks
 * LLM costs per feature and per authenticated user.
 */

import { meter, configure, MeterOptions } from '../src';

// Configure once at app startup
configure({
  adapters: ['console', 'local'],
  localPath: './.llm-costs/events.ndjson',
  defaultTags: {
    env: process.env.NODE_ENV ?? 'development',
    service: 'my-express-app',
  },
});

// Type augmentation for Express Request
// In a real app, add this to a .d.ts file
declare global {
  namespace Express {
    interface Request {
      llmMeter: <T>(fn: () => Promise<T>, options?: Partial<MeterOptions>) => Promise<T>;
      user?: { id: string };
      sessionId?: string;
    }
  }
}

/**
 * Express middleware that attaches a cost-tracking wrapper to each request.
 */
function withCostTracking(feature: string) {
  return (req: any, _res: any, next: any) => {
    req.llmMeter = <T>(fn: () => Promise<T>, options: Partial<MeterOptions> = {}) =>
      meter(fn, {
        feature,
        userId: req.user?.id,
        sessionId: req.sessionId,
        ...options,
      });
    next();
  };
}

// Example route handlers (pseudocode — requires express)
//
// import express from 'express';
// const app = express();
//
// app.post('/api/summarize',
//   withCostTracking('article-summarizer'),
//   async (req, res) => {
//     const result = await req.llmMeter(() =>
//       anthropicClient.messages.create({
//         model: 'claude-sonnet-4-20250514',
//         max_tokens: 1024,
//         messages: [{ role: 'user', content: req.body.text }]
//       })
//     );
//     res.json({ summary: result.content[0].text });
//   }
// );
//
// app.post('/api/classify',
//   withCostTracking('tag-classifier'),
//   async (req, res) => {
//     const result = await req.llmMeter(() =>
//       openaiClient.chat.completions.create({
//         model: 'gpt-4o-mini',
//         messages: [{ role: 'user', content: `Classify: ${req.body.text}` }]
//       })
//     );
//     res.json({ classification: result.choices[0].message.content });
//   }
// );
//
// app.listen(3000, () => console.log('Server running on :3000'));

export { withCostTracking };
