try {
  const data = await Bun.stdin.json();

  const url: string | undefined = data.url;
  if (!url) {
    throw new Error("Missing required parameter: url");
  }

  const method: string = (data.method || "GET").toUpperCase();
  const validMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
  if (!validMethods.includes(method)) {
    throw new Error(`Invalid method: ${method}. Must be one of: ${validMethods.join(", ")}`);
  }

  const headers: Record<string, string> = { ...(data.headers || {}) };
  const query: Record<string, string> | undefined = data.query;
  const auth: { type: string; token?: string; username?: string; password?: string } | undefined = data.auth;
  const timeout: number = data.timeout ?? 15000;
  const followRedirects: boolean = data.follow_redirects ?? true;

  // Build URL with query parameters
  const requestUrl = new URL(url);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      requestUrl.searchParams.set(key, String(value));
    }
  }

  // Handle authentication
  if (auth) {
    if (auth.type === "bearer" && auth.token) {
      headers["Authorization"] = `Bearer ${auth.token}`;
    } else if (auth.type === "basic" && auth.username != null && auth.password != null) {
      const encoded = btoa(`${auth.username}:${auth.password}`);
      headers["Authorization"] = `Basic ${encoded}`;
    } else {
      throw new Error(
        `Invalid auth config. Use { type: "bearer", token: "..." } or { type: "basic", username: "...", password: "..." }`
      );
    }
  }

  // Prepare body
  let requestBody: string | undefined;
  if (data.body !== undefined && data.body !== null) {
    if (typeof data.body === "object") {
      requestBody = JSON.stringify(data.body);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
    } else {
      requestBody = String(data.body);
    }
  }

  console.error(`${method} ${requestUrl.toString()}`);

  const start = Date.now();

  const response = await fetch(requestUrl.toString(), {
    method,
    headers,
    body: requestBody,
    redirect: followRedirects ? "follow" : "manual",
    signal: AbortSignal.timeout(timeout),
  });

  const elapsedMs = Date.now() - start;

  // Collect response headers
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  // Parse response body
  const contentType = response.headers.get("content-type") || "";
  let responseBody: any;

  if (method === "HEAD") {
    responseBody = null;
  } else {
    const rawText = await response.text();
    if (contentType.includes("application/json")) {
      try {
        responseBody = JSON.parse(rawText);
      } catch {
        responseBody = rawText;
      }
    } else {
      responseBody = rawText;
    }
  }

  console.error(`Response: ${response.status} ${response.statusText} (${elapsedMs}ms)`);

  console.log(
    JSON.stringify({
      status: response.status,
      status_text: response.statusText,
      headers: responseHeaders,
      body: responseBody,
      elapsed_ms: elapsedMs,
      url: response.url || requestUrl.toString(),
    })
  );
} catch (err: any) {
  console.error(err.message || String(err));
  console.log(JSON.stringify({ error: err.message || String(err) }));
}
