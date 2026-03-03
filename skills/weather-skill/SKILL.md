---
name: Weather
description: Current weather and 7-day forecast using Open-Meteo API
script: scripts/main.ts
language: javascript
install: none
timeout: 15
---

# Weather

Get current weather conditions and a 7-day forecast for any location using the free Open-Meteo API. No API key required.

## Input
- `location` (string, required): City name or "lat,lon" coordinates
- `units` (string, optional): "celsius" or "fahrenheit", default "celsius"

## Output
- `current` (object): Current weather with temp, humidity, wind_speed, description
- `forecast` (array): 7-day forecast with daily high/low, precipitation, description
- `location` (object): Resolved location details (name, latitude, longitude, country)
