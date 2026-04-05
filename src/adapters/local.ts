import * as fs from 'fs';
import * as path from 'path';
import { CostAdapter, CostEvent } from '../types';

export class LocalAdapter implements CostAdapter {
  name = 'local';
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async write(event: CostEvent): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(this.filePath, JSON.stringify(event) + '\n');
  }
}
