import { CostAdapter } from '../types';
import { ConsoleAdapter } from './console';
import { LocalAdapter } from './local';

export { ConsoleAdapter } from './console';
export { LocalAdapter } from './local';

export function createAdapter(
  name: string,
  options: { localPath?: string } = {}
): CostAdapter {
  switch (name) {
    case 'console':
      return new ConsoleAdapter();
    case 'local':
      return new LocalAdapter(options.localPath ?? './.llm-costs/events.ndjson');
    default:
      throw new Error(`Unknown adapter: ${name}. Available adapters: console, local`);
  }
}

export function resolveAdapters(
  adapters: Array<string | CostAdapter>,
  options: { localPath?: string } = {}
): CostAdapter[] {
  return adapters.map((adapter) => {
    if (typeof adapter === 'string') {
      return createAdapter(adapter, options);
    }
    return adapter;
  });
}
