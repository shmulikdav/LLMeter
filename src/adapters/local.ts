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
    // Queue writes sequentially to prevent corruption from concurrent calls
    this.writeQueue = this.writeQueue.then(() => this.doWrite(event));
    return this.writeQueue;
  }

  async flush(): Promise<void> {
    return this.writeQueue;
  }

  private async doWrite(event: CostEvent): Promise<void> {
    if (!this.dirCreated) {
      const dir = path.dirname(this.filePath);
      await fs.promises.mkdir(dir, { recursive: true });
      this.dirCreated = true;
    }
    await fs.promises.appendFile(this.filePath, JSON.stringify(event) + '\n');
  }
}
