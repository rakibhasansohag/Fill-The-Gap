// ============================================================
// logger.ts — Debug logger utility (no-op in production)
// ============================================================

const PREFIX = '[Fill-The-Gap]';
const IS_DEV = process.env.NODE_ENV === 'development';

export const logger = {
  info: (...args: unknown[]): void => {
    if (IS_DEV) console.info(PREFIX, ...args);
  },
  warn: (...args: unknown[]): void => {
    console.warn(PREFIX, ...args);
  },
  error: (...args: unknown[]): void => {
    console.error(PREFIX, ...args);
  },
  debug: (...args: unknown[]): void => {
    if (IS_DEV) console.debug(PREFIX, ...args);
  },
  group: (label: string): void => {
    if (IS_DEV) console.group(`${PREFIX} ${label}`);
  },
  groupEnd: (): void => {
    if (IS_DEV) console.groupEnd();
  },
};
