try {
  const data = await Bun.stdin.json();
  const coinsInput = data.coins;
  const currency: string = (data.currency || "usd").toLowerCase();

  if (!coinsInput) {
    throw new Error("Missing required parameter: coins");
  }

  const coinIds: string[] = Array.isArray(coinsInput)
    ? coinsInput.map((c: string) => c.toLowerCase())
    : coinsInput
        .toLowerCase()
        .split(",")
        .map((c: string) => c.trim());

  console.error(`Fetching prices for: ${coinIds.join(", ")} in ${currency}`);

  const idsParam = coinIds.join(",");
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${encodeURIComponent(currency)}&ids=${encodeURIComponent(idsParam)}&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h`;

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "ScalyClaw-CryptoPrice/1.0",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CoinGecko API error: ${res.status} ${res.statusText} - ${text}`);
  }

  const coins = await res.json();

  if (!Array.isArray(coins) || coins.length === 0) {
    throw new Error(`No data found for coins: ${coinIds.join(", ")}. Check coin IDs are valid CoinGecko IDs.`);
  }

  const prices: Record<string, any> = {};

  for (const coin of coins) {
    prices[coin.id] = {
      name: coin.name,
      symbol: coin.symbol.toUpperCase(),
      price: coin.current_price,
      currency: currency.toUpperCase(),
      market_cap: coin.market_cap,
      market_cap_rank: coin.market_cap_rank,
      "24h_volume": coin.total_volume,
      "24h_change": coin.price_change_24h,
      "24h_change_percent": coin.price_change_percentage_24h,
      high_24h: coin.high_24h,
      low_24h: coin.low_24h,
      circulating_supply: coin.circulating_supply,
      total_supply: coin.total_supply,
      ath: coin.ath,
      ath_date: coin.ath_date,
      last_updated: coin.last_updated,
      image: coin.image,
    };
  }

  const notFound = coinIds.filter((id) => !prices[id]);
  if (notFound.length > 0) {
    console.error(`Warning: no data found for: ${notFound.join(", ")}`);
  }

  console.log(JSON.stringify({ prices, currency: currency.toUpperCase(), not_found: notFound }));
} catch (err: any) {
  console.error(err.message);
  console.log(JSON.stringify({ error: err.message }));
}
