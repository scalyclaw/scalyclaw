const WMO_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow fall",
  73: "Moderate snow fall",
  75: "Heavy snow fall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string;
}

async function geocode(location: string): Promise<GeoResult> {
  const latLonMatch = location.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
  if (latLonMatch) {
    return {
      name: location,
      latitude: parseFloat(latLonMatch[1]),
      longitude: parseFloat(latLonMatch[2]),
      country: "Unknown",
    };
  }

  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding API error: ${res.status} ${res.statusText}`);
  const data = await res.json();

  if (!data.results || data.results.length === 0) {
    throw new Error(`Location not found: "${location}"`);
  }

  const r = data.results[0];
  return {
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    country: r.country,
    admin1: r.admin1,
  };
}

async function fetchWeather(lat: number, lon: number, units: string) {
  const tempUnit = units === "fahrenheit" ? "fahrenheit" : "celsius";
  const windUnit = units === "fahrenheit" ? "mph" : "kmh";

  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    current: "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code",
    temperature_unit: tempUnit,
    wind_speed_unit: windUnit,
    timezone: "auto",
    forecast_days: "7",
  });

  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather API error: ${res.status} ${res.statusText}`);
  return res.json();
}

try {
  const data = await Bun.stdin.json();
  const location: string = data.location;
  const units: string = data.units || "celsius";

  if (!location) {
    throw new Error("Missing required parameter: location");
  }

  const geo = await geocode(location);
  console.error(`Resolved location: ${geo.name}, ${geo.country} (${geo.latitude}, ${geo.longitude})`);

  const weather = await fetchWeather(geo.latitude, geo.longitude, units);

  const tempUnitLabel = units === "fahrenheit" ? "F" : "C";
  const windUnitLabel = units === "fahrenheit" ? "mph" : "km/h";

  const current = {
    temp: weather.current.temperature_2m,
    temp_unit: tempUnitLabel,
    humidity: weather.current.relative_humidity_2m,
    wind_speed: weather.current.wind_speed_10m,
    wind_unit: windUnitLabel,
    description: WMO_CODES[weather.current.weather_code] || "Unknown",
    weather_code: weather.current.weather_code,
  };

  const forecast = weather.daily.time.map((date: string, i: number) => ({
    date,
    temp_max: weather.daily.temperature_2m_max[i],
    temp_min: weather.daily.temperature_2m_min[i],
    temp_unit: tempUnitLabel,
    precipitation_mm: weather.daily.precipitation_sum[i],
    description: WMO_CODES[weather.daily.weather_code[i]] || "Unknown",
    weather_code: weather.daily.weather_code[i],
  }));

  const result = {
    current,
    forecast,
    location: {
      name: geo.name,
      latitude: geo.latitude,
      longitude: geo.longitude,
      country: geo.country,
      admin1: geo.admin1 || null,
      timezone: weather.timezone,
    },
  };

  console.log(JSON.stringify(result));
} catch (err: any) {
  console.error(err.message);
  console.log(JSON.stringify({ error: err.message }));
}
