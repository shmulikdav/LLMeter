/**
 * Next.js API route integration example for llm-cost-meter
 *
 * Shows how to use meter() in a Next.js API route handler
 * to track LLM costs per feature and per user.
 */

import { meter, configure } from '../src';

// Configure once (this runs when the module is first imported)
configure({
  adapters: ['local'],
  localPath: './.llm-costs/events.ndjson',
  defaultTags: {
    env: process.env.NODE_ENV ?? 'development',
    service: 'my-nextjs-app',
  },
});

// Example Next.js API route handler
//
// // pages/api/chat.ts (Pages Router)
// import type { NextApiRequest, NextApiResponse } from 'next';
// import { meter } from 'llm-cost-meter';
// import OpenAI from 'openai';
//
// const openai = new OpenAI();
//
// export default async function handler(
//   req: NextApiRequest,
//   res: NextApiResponse
// ) {
//   if (req.method !== 'POST') {
//     return res.status(405).json({ error: 'Method not allowed' });
//   }
//
//   const { message, userId } = req.body;
//
//   const response = await meter(
//     () => openai.chat.completions.create({
//       model: 'gpt-4o',
//       messages: [
//         { role: 'system', content: 'You are a helpful assistant.' },
//         { role: 'user', content: message }
//       ],
//     }),
//     {
//       feature: 'chat',
//       userId,
//       tags: { route: '/api/chat' },
//     }
//   );
//
//   res.json({
//     reply: response.choices[0].message.content,
//   });
// }

// Example Next.js App Router (Route Handler)
//
// // app/api/summarize/route.ts
// import { meter } from 'llm-cost-meter';
// import Anthropic from '@anthropic-ai/sdk';
//
// const anthropic = new Anthropic();
//
// export async function POST(request: Request) {
//   const { text, userId } = await request.json();
//
//   const response = await meter(
//     () => anthropic.messages.create({
//       model: 'claude-sonnet-4-20250514',
//       max_tokens: 1024,
//       messages: [{ role: 'user', content: `Summarize: ${text}` }],
//     }),
//     {
//       feature: 'article-summarizer',
//       userId,
//       tags: { route: '/api/summarize' },
//     }
//   );
//
//   return Response.json({
//     summary: response.content[0].text,
//   });
// }

export {};
