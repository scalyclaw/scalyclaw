import dns from "dns/promises";
import whoisLookup from "whois";

function whoisQuery(domain: string): Promise<string> {
  return new Promise((resolve, reject) => {
    whoisLookup.lookup(domain, (err: Error | null, data: string) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

async function lookupRecords(domain: string, type: string): Promise<Record<string, any>> {
  const records: Record<string, any> = {};
  const types = type === "all" ? ["A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA"] : [type.toUpperCase()];

  for (const t of types) {
    try {
      switch (t) {
        case "A": {
          const result = await dns.resolve4(domain);
          records.A = result;
          break;
        }
        case "AAAA": {
          const result = await dns.resolve6(domain);
          records.AAAA = result;
          break;
        }
        case "MX": {
          const result = await dns.resolveMx(domain);
          records.MX = result.sort((a, b) => a.priority - b.priority).map((mx) => ({
            exchange: mx.exchange,
            priority: mx.priority,
          }));
          break;
        }
        case "NS": {
          const result = await dns.resolveNs(domain);
          records.NS = result;
          break;
        }
        case "TXT": {
          const result = await dns.resolveTxt(domain);
          records.TXT = result.map((entries) => entries.join(""));
          break;
        }
        case "CNAME": {
          const result = await dns.resolveCname(domain);
          records.CNAME = result;
          break;
        }
        case "SOA": {
          const result = await dns.resolveSoa(domain);
          records.SOA = result;
          break;
        }
      }
    } catch (err: any) {
      if (type !== "all") {
        throw err;
      }
      console.error(`No ${t} records for ${domain}: ${err.code || err.message}`);
    }
  }

  return records;
}

try {
  const data = await Bun.stdin.json();
  const domain: string = data.domain;
  const type: string = (data.type || "all").toUpperCase();
  const includeWhois: boolean = data.whois === true;

  if (!domain) {
    throw new Error("Missing required parameter: domain");
  }

  const validTypes = ["A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA", "ALL"];
  if (!validTypes.includes(type)) {
    throw new Error(`Invalid type: ${type}. Must be one of: ${validTypes.join(", ")}`);
  }

  console.error(`Looking up DNS records for: ${domain} (type: ${type})`);

  const records = await lookupRecords(domain, type);

  const result: Record<string, any> = {
    domain,
    records,
  };

  if (includeWhois) {
    console.error(`Fetching WHOIS data for: ${domain}`);
    try {
      const whoisData = await whoisQuery(domain);
      result.whois_data = whoisData;
    } catch (err: any) {
      console.error(`WHOIS lookup failed: ${err.message}`);
      result.whois_data = null;
      result.whois_error = err.message;
    }
  }

  console.log(JSON.stringify(result));
} catch (err: any) {
  console.error(err.message);
  console.log(JSON.stringify({ error: err.message }));
}
