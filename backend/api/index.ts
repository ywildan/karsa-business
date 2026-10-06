import app from "../functions/api.js";
export default {
  fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/index") url.pathname = "/health";
    return app.fetch(new Request(url, request));
  },
};
