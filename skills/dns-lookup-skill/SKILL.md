---
name: DNS Lookup
description: DNS records and WHOIS domain info
script: scripts/main.ts
language: javascript
install: bun install
timeout: 15
---

# DNS Lookup

Look up DNS records for a domain and optionally fetch WHOIS information.

## Input
- `domain` (string, required): Domain name to look up
- `type` (string, optional): Record type - "A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA", or "all" (default "all")
- `whois` (boolean, optional): Whether to include WHOIS data, default false

## Output
- `records` (object): DNS records organized by type
- `whois_data` (string): WHOIS information (if requested)
