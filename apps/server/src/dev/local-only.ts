// The development tools (dev:fixtures, dev:scrape) must never touch a real server's data: they refuse to
// run unless DATABASE_URL points at this machine.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/** Throws unless `url` is a Postgres URL whose host is localhost or 127.0.0.1. */
export function assertLocalDatabase(url: string | undefined, tool: string): void {
  const refuse = (why: string): never => {
    throw new Error(
      `${tool} is a development tool and only runs against a local database: ${why}. ` +
        'Set DATABASE_URL to a postgres:// URL on localhost or 127.0.0.1 (docker/compose.yaml).',
    );
  };
  if (!url) return refuse('DATABASE_URL is not set');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return refuse('DATABASE_URL is not a valid URL');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    return refuse('DATABASE_URL is not a postgres:// URL');
  }
  // libpq lets a query parameter override the host: `postgres://localhost/db?host=prod.example.com`
  if (parsed.searchParams.has('host') || parsed.searchParams.has('hostaddr')) {
    return refuse('DATABASE_URL carries a host override in its query string');
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    return refuse(`the host is "${parsed.hostname}"`);
  }
}
