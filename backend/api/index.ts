import app from "../functions/api.js";
import { routeVercelRequest } from "../functions/vercel-request.js";
import { firebaseWebConfig, proxyFirebaseAuth } from "../functions/firebase-auth-proxy.js";
export default {
  fetch(request: Request) {
    const routed = routeVercelRequest(request);
    const path = new URL(routed.url).pathname;
    if (path === "/__/firebase/init.json") {
      if (routed.method !== "GET") return new Response("Method not allowed", {status:405,headers:{Allow:"GET"}});
      const projectId=process.env.FIREBASE_PROJECT_ID;
      const apiKey=process.env.FIREBASE_WEB_API_KEY;
      if (!projectId || !apiKey) return new Response("Authentication not configured", {status:503});
      return Response.json(firebaseWebConfig(routed,projectId,apiKey),{headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
    }
    if (path.startsWith("/__")) {
      return proxyFirebaseAuth(routed, process.env.FIREBASE_PROJECT_ID || "");
    }
    return app.fetch(routed);
  },
};
