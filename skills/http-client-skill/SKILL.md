---
name: HTTP Client
description: Make HTTP requests with full control over method, headers, auth, body, and query params
script: scripts/main.ts
language: javascript
install: none
timeout: 30
---

# HTTP Client

Make HTTP requests with full control over method, headers, authentication, body, and query parameters. Essential for API integration.

## Input
- `url` (string, required): Request URL
- `method` (string, optional, default "GET"): HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
- `headers` (object, optional): Custom request headers
- `body` (any, optional): Request body — string or object (auto-serialized to JSON if object)
- `query` (object, optional): Query parameters (appended to URL)
- `auth` (object, optional): `{ type: "bearer", token: "..." }` or `{ type: "basic", username: "...", password: "..." }`
- `timeout` (integer, optional, default 15000): Request timeout in milliseconds
- `follow_redirects` (boolean, optional, default true): Follow HTTP redirects

## Output
- `status` (integer): HTTP status code
- `status_text` (string): Status text
- `headers` (object): Response headers
- `body` (any): Response body — parsed as JSON if content-type is application/json, otherwise string
- `elapsed_ms` (integer): Request duration in milliseconds
- `url` (string): Final URL (after redirects)
