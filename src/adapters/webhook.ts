import { CostAdapter, CostEvent, WebhookAdapterConfig } from '../types';

export class WebhookAdapter implements CostAdapter {
  name = 'webhook';
  private config: Required<WebhookAdapterConfig>;
  private buffer: CostEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: WebhookAdapterConfig) {
    this.config = {
      url: config.url,
      headers: config.headers ?? {},
      batchSize: config.batchSize ?? 1,
      flushIntervalMs: config.flushIntervalMs ?? 5000,
      timeoutMs: config.timeoutMs ?? 10000,
    };

    if (this.config.batchSize > 1) {
      this.timer = setInterval(() => this.flushBuffer(), this.config.flushIntervalMs);
      if (this.timer.unref) this.timer.unref(); // Don't keep process alive
    }
  }

  async write(event: CostEvent): Promise<void> {
    if (this.config.batchSize <= 1) {
      await this.send([event]);
      return;
    }

    this.buffer.push(event);
    if (this.buffer.length >= this.config.batchSize) {
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
    await this.send(batch);
  }

  private async send(events: CostEvent[], retries = 1): Promise<void> {
    const body = events.length === 1 ? JSON.stringify(events[0]) : JSON.stringify(events);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers,
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok && retries > 0) {
        await new Promise((r) => setTimeout(r, 100));
        return this.send(events, retries - 1);
      }
    } catch (err) {
      if (retries > 0) {
        await new Promise((r) => setTimeout(r, 100));
        return this.send(events, retries - 1);
      }
      throw err;
    }
  }
}
