import yahooFinance from "yahoo-finance2";

const PERIOD_MAP: Record<string, number> = {
  "1d": 1,
  "5d": 5,
  "1mo": 30,
  "3mo": 90,
  "6mo": 180,
  "1y": 365,
  "2y": 730,
  "5y": 1825,
  "max": 365 * 50,
};

async function getQuote(symbol: string) {
  const result = await yahooFinance.quote(symbol);

  return {
    symbol: result.symbol,
    name: result.shortName || result.longName || null,
    currency: result.currency || null,
    price: result.regularMarketPrice ?? null,
    change: result.regularMarketChange ?? null,
    change_percent: result.regularMarketChangePercent ?? null,
    open: result.regularMarketOpen ?? null,
    high: result.regularMarketDayHigh ?? null,
    low: result.regularMarketDayLow ?? null,
    previous_close: result.regularMarketPreviousClose ?? null,
    volume: result.regularMarketVolume ?? null,
    market_cap: result.marketCap ?? null,
    pe_ratio: result.trailingPE ?? null,
    dividend_yield: result.dividendYield ?? null,
    fifty_two_week_high: result.fiftyTwoWeekHigh ?? null,
    fifty_two_week_low: result.fiftyTwoWeekLow ?? null,
    exchange: result.fullExchangeName || result.exchange || null,
  };
}

async function getHistory(symbol: string, period: string) {
  const days = PERIOD_MAP[period] || PERIOD_MAP["1mo"];
  const now = new Date();
  const period1 = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const result = await yahooFinance.chart(symbol, {
    period1: period1.toISOString().split("T")[0],
    period2: now.toISOString().split("T")[0],
  });

  const data = (result.quotes || []).map((q: any) => ({
    date: q.date instanceof Date ? q.date.toISOString().split("T")[0] : String(q.date),
    open: q.open ?? null,
    high: q.high ?? null,
    low: q.low ?? null,
    close: q.close ?? null,
    volume: q.volume ?? null,
    adj_close: q.adjclose ?? q.close ?? null,
  }));

  return { symbol, period, data };
}

async function searchSymbols(query: string) {
  const result = await yahooFinance.search(query);

  const results = (result.quotes || []).map((q: any) => ({
    symbol: q.symbol,
    name: q.shortname || q.longname || null,
    exchange: q.exchDisp || q.exchange || null,
    type: q.quoteType || q.typeDisp || null,
  }));

  return { results };
}

try {
  const input = await Bun.stdin.json();
  const action: string = input.action || "quote";
  const symbol: string = input.symbol || "";
  const period: string = input.period || "1mo";
  const query: string = input.query || "";

  let result: any;

  switch (action) {
    case "quote": {
      if (!symbol) throw new Error("Missing required parameter: symbol");
      console.error(`Fetching quote for ${symbol}`);
      result = await getQuote(symbol.toUpperCase());
      break;
    }
    case "history": {
      if (!symbol) throw new Error("Missing required parameter: symbol");
      console.error(`Fetching history for ${symbol} (period: ${period})`);
      result = await getHistory(symbol.toUpperCase(), period);
      break;
    }
    case "search": {
      const searchTerm = query || symbol;
      if (!searchTerm) throw new Error("Missing required parameter: query or symbol");
      console.error(`Searching for "${searchTerm}"`);
      result = await searchSymbols(searchTerm);
      break;
    }
    default:
      throw new Error(`Unknown action: ${action}. Use "quote", "history", or "search".`);
  }

  console.log(JSON.stringify(result));
} catch (err: any) {
  console.error(err.message);
  console.log(JSON.stringify({ error: err.message }));
}
