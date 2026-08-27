/** LAN/dev hostnames allowed by exact hostname match (not substring). */
const LOCAL_HOSTS = new Set(['bird.lan', '192.168.253.3', 'localhost', '127.0.0.1']);

function configuredOrigins(): string[] {
  return (process.env.CORS_ORIGIN || '*')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function isLocalHostOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return LOCAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  // Non-browser clients (curl, some native apps) send no Origin
  if (!origin) return true;

  const configured = configuredOrigins();
  if (configured.includes('*')) return true;
  if (configured.includes(origin)) return true;

  return isLocalHostOrigin(origin);
}
