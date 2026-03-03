---
name: Crypto Price
description: Get cryptocurrency prices from CoinGecko
script: scripts/main.ts
language: javascript
install: none
timeout: 15
---

# Crypto Price

Get current cryptocurrency prices, market cap, and 24-hour change data from the CoinGecko API. No API key required.

## Input
- `coins` (string or array, required): Coin ID(s) like "bitcoin", "ethereum"
- `currency` (string, optional): Target currency, default "usd"

## Output
- `prices` (object): Price data per coin including price, market_cap, 24h_change, 24h_volume, last_updated
