import { serve } from "https://deno.land/std@0.140.0/http/server.ts";

async function handler(req: Request): Promise<Response> {
  try {
    const html = await Deno.readTextFile("./index.html");
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch {
    return new Response("Error: index.html file not found.", { status: 500 });
  }
}

console.log("Deno server started...");
serve(handler);


