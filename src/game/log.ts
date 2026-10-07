// Content-log helpers. The pack's tsconfig has no DOM/Node libs, so declare the
// subset of the engine's global console that we use (module-scoped; no global pollution).
declare const console: {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

const TAG = "[colony]";

export function logInfo(msg: string): void {
  console.log(`${TAG} ${msg}`);
}

export function logWarn(msg: string): void {
  console.warn(`${TAG} ${msg}`);
}

export function logError(msg: string, err?: unknown): void {
  console.error(err === undefined ? `${TAG} ${msg}` : `${TAG} ${msg}: ${errText(err)}`);
}

export function errText(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}
