export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

export const methodNotAllowed = (allow: string) =>
  json(405, { error: 'Method Not Allowed' }, { Allow: allow });
