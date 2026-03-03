---
name: Stock Price
description: Get stock prices, company info, and historical data using Yahoo Finance
script: scripts/main.ts
language: javascript
install: bun install
timeout: 15
---

# Stock Price

Get stock prices, company info, and historical data using Yahoo Finance. No API key required.

## Input
- `symbol` (string, required): Stock ticker symbol (e.g. "AAPL", "MSFT", "TSLA")
- `action` (string, optional): "quote" (current price), "history" (historical data), "search" (find symbols) — default "quote"
- `period` (string, optional, for history): "1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "max" — default "1mo"
- `query` (string, for search): Search term to find stock symbols

## Output (quote)
- `symbol`, `name`, `currency`, `price`, `change`, `change_percent`, `open`, `high`, `low`, `previous_close`, `volume`, `market_cap`, `pe_ratio`, `dividend_yield`, `fifty_two_week_high`, `fifty_two_week_low`, `exchange`

## Output (history)
- `symbol`, `period`, `data` (array of `{ date, open, high, low, close, volume, adj_close }`)

## Output (search)
- `results` (array of `{ symbol, name, exchange, type }`)
