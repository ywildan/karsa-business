const helpers = new Set([
  "/__/auth/handler", "/__/auth/handler.js", "/__/auth/experiments.js",
  "/__/auth/iframe", "/__/auth/iframe.js", "/__/auth/links", "/__/auth/links.js",
]);
export const authHelperCsp = "default-src 'self'; script-src 'self' 'nonce-firebase-auth-helper' https://www.gstatic.com https://apis.google.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.googleapis.com https://*.firebaseapp.com https://www.gstatic.com; frame-src 'self' https://*.firebaseapp.com https://accounts.google.com; img-src 'self' data: https://*.googleusercontent.com; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self' https://accounts.google.com";

export function firebaseWebConfig(request: Request, projectId: string, apiKey: string) {
  return {apiKey, projectId, authDomain: new URL(request.url).host};
}

/** Relay only Firebase's sign-in helpers; callers cannot choose an upstream host. */
export async function proxyFirebaseAuth(request: Request, projectId: string, transport: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  if (!helpers.has(url.pathname)) return new Response("Not found", {status:404});
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) return new Response("Authentication not configured", {status:503});
  if (!['GET','POST'].includes(request.method)) return new Response("Method not allowed", {status:405,headers:{Allow:"GET, POST"}});
  const upstream = new URL(`https://${projectId}.firebaseapp.com`);
  upstream.pathname = url.pathname;
  upstream.search = url.search;
  const headers = new Headers();
  for (const name of ['Accept','Content-Type']) {
    const value = request.headers.get(name);
    if (value) headers.set(name,value);
  }
  let body: Uint8Array | undefined;
  if (request.method === 'POST') {
    const reader=request.body?.getReader(); const chunks:Uint8Array[]=[];let size=0;
    if (reader) {
      while (true) {
        const part=await reader.read();if(part.done)break;
        size+=part.value.byteLength;
        if(size>131072){await reader.cancel();return new Response("Request too large",{status:413});}
        chunks.push(part.value);
      }
    }
    body=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
  }
  try {
    const response=await transport(upstream,{method:request.method,headers,body:body as BodyInit | undefined,redirect:'manual',signal:AbortSignal.timeout(15000)});
    const output = new Headers(response.headers);
    for (const name of ['content-encoding','content-length','transfer-encoding','connection','keep-alive','set-cookie']) output.delete(name);
    output.set('Cache-Control','no-store');
    output.set('X-Frame-Options','SAMEORIGIN');
    output.set('Content-Security-Policy',authHelperCsp);
    output.set('X-Content-Type-Options','nosniff');
    const location=output.get('Location');
    if(location){
      const destination=new URL(location,upstream);
      if(destination.origin===upstream.origin && helpers.has(destination.pathname)) {
        destination.protocol=url.protocol;destination.host=url.host;
        output.set('Location',destination.toString());
      }
    }
    return new Response(response.body,{status:response.status,headers:output});
  } catch {
    return new Response("Authentication service temporarily unavailable",{status:503,headers:{'Cache-Control':'no-store'}});
  }
}
