export function htmlResponse(message: string, status: number): Response {
  return new Response(
    `<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:80px">` +
      `<h2>${message}</h2></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
