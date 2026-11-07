// Request filters can contain private source names. Keep query strings, bodies,
// headers, addresses, and upstream error messages outside operational logs.
export const safeHttpLogSerializers = {
  req(request: { method?: string; url?: string; routeOptions?: { url?: string } }) {
    return { method: request.method, route: request.routeOptions?.url ?? request.url?.split("?", 1)[0] };
  },
  err(_error: unknown) { return { type: "request_error", message: "Request failed", stack: "" }; }
};
