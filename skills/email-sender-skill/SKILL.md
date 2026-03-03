---
name: Email Sender
description: Send emails via SMTP
script: scripts/main.ts
language: javascript
install: bun install
timeout: 15
---

# Email Sender

Send emails via SMTP. Supports HTML content, multiple recipients, and file attachments.

## Input
- `to` (string or array, required): Recipient email address(es)
- `subject` (string, required): Email subject
- `body` (string, required): Plain text email body
- `html` (string, optional): HTML email body
- `from` (string, optional): Sender address
- `smtp_host` (string, optional): SMTP server host (or SMTP_HOST env var)
- `smtp_port` (integer, optional): SMTP server port (or SMTP_PORT env var)
- `smtp_user` (string, optional): SMTP username (or SMTP_USER env var)
- `smtp_pass` (string, optional): SMTP password (or SMTP_PASS env var)
- `attachments` (array, optional): Array of {filename, path} objects

## Secrets

SMTP credentials can be stored in the vault and are auto-injected as environment variables:
- `$SMTP_HOST` — SMTP server hostname
- `$SMTP_PORT` — SMTP server port
- `$SMTP_USER` — SMTP username
- `$SMTP_PASS` — SMTP password

Store them via: `vault_store({ name: "SMTP_HOST", value: "smtp.example.com" })`, etc.
When these vault secrets exist, the skill reads them from env vars automatically — no need to pass them in the input.

## Output
- `success` (boolean): Whether the email was sent successfully
- `messageId` (string): The message ID from the SMTP server
