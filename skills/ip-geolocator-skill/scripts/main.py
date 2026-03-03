import sys
import json


def main():
    try:
        data = json.loads(sys.stdin.read())
        ip = data.get("ip")
        if not ip:
            print(json.dumps({"error": "Missing required field: ip"}))
            return

        import httpx

        sys.stderr.write(f"Looking up IP: {ip}\n")
        response = httpx.get(
            f"http://ip-api.com/json/{ip}",
            params={"fields": "status,message,country,countryCode,regionName,city,lat,lon,isp,timezone,query"},
            timeout=10,
        )
        response.raise_for_status()
        api_data = response.json()

        if api_data.get("status") == "fail":
            print(json.dumps({"error": api_data.get("message", "IP lookup failed")}))
            return

        result = {
            "ip": api_data.get("query", ip),
            "country": api_data.get("country", ""),
            "country_code": api_data.get("countryCode", ""),
            "region": api_data.get("regionName", ""),
            "city": api_data.get("city", ""),
            "lat": api_data.get("lat", 0),
            "lon": api_data.get("lon", 0),
            "isp": api_data.get("isp", ""),
            "timezone": api_data.get("timezone", ""),
        }

        print(json.dumps(result))
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
