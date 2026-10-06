import app from "../functions/api.js";
import { routeVercelRequest } from "../functions/vercel-request.js";
export default {
  fetch(request: Request) {
    return app.fetch(routeVercelRequest(request));
  },
};
