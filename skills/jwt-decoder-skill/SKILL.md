---
name: JWT Decoder
description: Decode JWT tokens without verification, extracting header, payload, and expiration info
script: target/release/jwt-decoder-skill
language: rust
install: cargo build --release
timeout: 10
---

# JWT Decoder

Decode JSON Web Tokens (JWT) without cryptographic verification. Splits the token by '.', base64-decodes the header and payload, and checks expiration status.

## Input
- `token` (string): The JWT token string to decode

## Output
- `header` (object): The decoded JWT header
- `payload` (object): The decoded JWT payload
- `expired` (boolean): Whether the token has expired (based on the exp claim compared to current time)
- `issued_at` (string): ISO 8601 timestamp of when the token was issued (if iat claim is present)
- `expires_at` (string): ISO 8601 timestamp of when the token expires (if exp claim is present)
