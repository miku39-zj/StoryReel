/** Single-workspace access policy, shared by middleware and private-media delivery. */
export function editorAuthorized(request: Request): boolean {
  const user = process.env.STORYREEL_EDITOR_USER;
  const password = process.env.STORYREEL_EDITOR_PASSWORD;
  if (!user && !password && process.env.NODE_ENV !== "production") {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
  }
  if (!user || !password) return false;
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ") || header.length > 8192) return false;
  try {
    const received = atob(header.slice(6));
    const expected = new TextEncoder().encode(`${user}:${password}`);
    let difference = received.length ^ expected.length;
    for (let i = 0; i < expected.length; i++)
      difference |= (received.charCodeAt(i) || 0) ^ expected[i];
    return difference === 0;
  } catch {
    return false;
  }
}
export function editorChallenge() {
  return new Response("需要工作区编辑凭据", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="StoryReel workspace", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}
export function publicRoute(path: string) {
  return (
    /^\/player\/[\w-]+\/?$/.test(path) ||
    /^\/api\/publications\/[\w-]+\/?$/.test(path) ||
    /^\/api\/media\/[\w-]+\/?$/.test(path)
  );
}
export function sameOriginMutation(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const origin = request.headers.get("origin");
  if (!origin) return true; // Authenticated CLI clients do not send Origin.
  try {
    return new URL(origin).host === (request.headers.get("host") ?? new URL(request.url).host);
  } catch {
    return false;
  }
}
