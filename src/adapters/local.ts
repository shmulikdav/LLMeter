import * as fs from 'fs';
import * as path from 'path';
import { CostAdapter, CostEvent } from '../types';

export class LocalAdapter implements CostAdapter {
  name = 'local';
  private filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private dirCreated = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async write(event: CostEvent): Promise<void> {
    this.writeQueue = this.writeQueue.then(
      () => this.doWrite(event),
      () => this.doWrite(event) // recover from previous failure — don't stall queue
    );
    return this.writeQueue;
  }

  async flush(): Promise<void> {
    return this.writeQueue;
  }

  private async doWrite(event: CostEvent, retries = 1): Promise<void> {
    if (!this.dirCreated) {
      const dir = path.dirname(this.filePath);
      await fs.promises.mkdir(dir, { recursive: true });
      this.dirCreated = true;
    }
    try {
      await fs.promises.appendFile(this.filePath, JSON.stringify(event) + '\n');
    } catch (err) {
      if (retries > 0) {
        await new Promise((r) => setTimeout(r, 100));
        return this.doWrite(event, retries - 1);
      }
      throw err;
    }
  }
}
