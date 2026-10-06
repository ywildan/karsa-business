/** Preserve the original API path even when a runtime exposes the rewrite destination. */
export function routeVercelRequest(request: Request): Request {
  const url = new URL(request.url);
  const route = url.searchParams.get("route");
  if (url.pathname === "/api/index") {
    if (route && (/^\/v[12]\//.test(route) || route === "/health" || route === "/web-config" || route.startsWith("/__/auth/") || route === "/__/firebase/init.json")) {
      url.pathname = route;
    } else if (!route) {
      url.pathname = "/health";
    }
  }
  url.searchParams.delete("route");
  return new Request(url, request);
}
