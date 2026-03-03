---
name: IP Geolocator
description: Get geolocation data for IP addresses
script: scripts/main.py
language: python
install: uv sync
timeout: 15
---

# IP Geolocator Skill

Get geolocation data for any IP address using ip-api.com (free, no API key required).

## Input
- `ip` (string, required): IP address to geolocate

## Output
- `ip` (string): The queried IP address
- `country` (string): Country name
- `country_code` (string): Country code (ISO 3166-1 alpha-2)
- `region` (string): Region/state name
- `city` (string): City name
- `lat` (number): Latitude
- `lon` (number): Longitude
- `isp` (string): Internet service provider
- `timezone` (string): Timezone
