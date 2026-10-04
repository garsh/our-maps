export class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** 401, 403, and 404 are answers from the server. A network failure has no status. */
export function mapRequestDenial(err: unknown): 401 | 403 | 404 | null {
  const status = typeof err === 'object' && err !== null && 'status' in err
    ? Number((err as { status: unknown }).status)
    : NaN;
  if (status === 401 || status === 403 || status === 404) return status;
  const message = err instanceof Error ? err.message : '';
  if (/authentication required|unauthorized/i.test(message)) return 401;
  if (/access denied/i.test(message)) return 403;
  if (message === 'Map not found') return 404;
  return null;
}
