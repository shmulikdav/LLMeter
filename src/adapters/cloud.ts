import { CostAdapter, CostEvent } from '../types';

export interface CloudAdapterConfig {
  apiKey: string;
  endpoint?: string;
  batchSize?: number;
  flushIntervalMs?: number;
}

/**
 * Cloud adapter that sends cost events to the llm-cost-meter cloud service.
 * Events are batched and flushed periodically for efficiency.
 *
 * @example
 * ```typescript
 * configure({
 *   adapters: ['local', 'cloud'],
 *   cloudApiKey: 'lm_live_abc123',
 * });
 * ```
 */
export class CloudAdapter implements CostAdapter {
  name = 'cloud';
  private apiKey: string;
  private endpoint: string;
  private batchSize: number;
  private buffer: CostEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: CloudAdapterConfig) {
    this.apiKey = config.apiKey;
    this.endpoint = config.endpoint ?? 'https://api.llmeter.dev/v1/events';
    this.batchSize = config.batchSize ?? 50;
    const flushMs = config.flushIntervalMs ?? 5000;

    this.timer = setInterval(() => this.flushBuffer(), flushMs);
    if (this.timer.unref) this.timer.unref();
  }

  async write(event: CostEvent): Promise<void> {
    this.buffer.push(event);
    if (this.buffer.length >= this.batchSize) {
      await this.flushBuffer();
    }
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.buffer.length > 0) {
      await this.flushBuffer();
    }
  }

  private async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'X-Source': 'llm-cost-meter',
        },
        body: JSON.stringify({ events: batch }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
    } catch {
      // On failure, put events back at the front of the buffer
      // (up to batchSize to prevent unbounded growth)
      if (this.buffer.length < this.batchSize * 2) {
        this.buffer.unshift(...batch);
      }
    }
  }
}
