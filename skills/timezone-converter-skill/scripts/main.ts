import { DateTime } from "luxon";

function formatDateTime(dt: DateTime) {
  return {
    time: dt.toFormat("HH:mm:ss"),
    timezone: dt.zoneName,
    offset: dt.toFormat("ZZ"),
    date: dt.toFormat("yyyy-MM-dd"),
    day_of_week: dt.toFormat("cccc"),
  };
}

function convertTime(time: string, fromTimezone: string, toTimezones: string | string[]) {
  // If time is just HH:mm or HH:mm:ss, assume today's date
  let dt: DateTime;
  const timeOnly = /^\d{1,2}:\d{2}(:\d{2})?$/.test(time);

  if (timeOnly) {
    const now = DateTime.now().setZone(fromTimezone);
    const parts = time.split(":");
    dt = now.set({
      hour: parseInt(parts[0]),
      minute: parseInt(parts[1]),
      second: parts[2] ? parseInt(parts[2]) : 0,
      millisecond: 0,
    });
  } else {
    dt = DateTime.fromISO(time, { zone: fromTimezone });
  }

  if (!dt.isValid) {
    throw new Error(`Invalid time "${time}" or timezone "${fromTimezone}": ${dt.invalidReason}`);
  }

  const targets = Array.isArray(toTimezones) ? toTimezones : [toTimezones];

  const original = {
    time: dt.toFormat("HH:mm:ss"),
    timezone: dt.zoneName,
    offset: dt.toFormat("ZZ"),
  };

  const converted = targets.map((tz) => {
    const converted = dt.setZone(tz);
    if (!converted.isValid) {
      throw new Error(`Invalid target timezone: "${tz}"`);
    }
    return formatDateTime(converted);
  });

  return { original, converted };
}

function worldClock(timezones: string[]) {
  const times = timezones.map((tz) => {
    const dt = DateTime.now().setZone(tz);
    if (!dt.isValid) {
      throw new Error(`Invalid timezone: "${tz}"`);
    }
    return formatDateTime(dt);
  });

  return { times };
}

function listTimezones(filter?: string) {
  let zones: string[];

  try {
    zones = (Intl as any).supportedValuesOf("timeZone");
  } catch {
    // Fallback: use a basic list if the runtime doesn't support supportedValuesOf
    zones = [
      "UTC",
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "Europe/London",
      "Europe/Paris",
      "Europe/Berlin",
      "Asia/Tokyo",
      "Asia/Shanghai",
      "Asia/Kolkata",
      "Australia/Sydney",
      "Pacific/Auckland",
    ];
  }

  if (filter) {
    const lowerFilter = filter.toLowerCase();
    zones = zones.filter((z) => z.toLowerCase().includes(lowerFilter));
  }

  const timezones = zones.map((name) => {
    const dt = DateTime.now().setZone(name);
    return {
      name,
      offset: dt.toFormat("ZZ"),
      abbreviation: dt.toFormat("ZZZZ"),
    };
  });

  return { timezones };
}

try {
  const input = await Bun.stdin.json();
  const action: string = input.action || "convert";

  let result: any;

  switch (action) {
    case "convert": {
      const time: string = input.time;
      const fromTz: string = input.from_timezone;
      const toTz: string | string[] = input.to_timezone;

      if (!time) throw new Error("Missing required parameter: time");
      if (!fromTz) throw new Error("Missing required parameter: from_timezone");
      if (!toTz) throw new Error("Missing required parameter: to_timezone");

      console.error(`Converting ${time} from ${fromTz} to ${Array.isArray(toTz) ? toTz.join(", ") : toTz}`);
      result = convertTime(time, fromTz, toTz);
      break;
    }
    case "now": {
      const timezones: string[] = input.timezones;
      if (!timezones || !Array.isArray(timezones) || timezones.length === 0) {
        throw new Error("Missing required parameter: timezones (array of timezone strings)");
      }

      console.error(`Showing current time for ${timezones.length} timezone(s)`);
      result = worldClock(timezones);
      break;
    }
    case "list": {
      const filter: string | undefined = input.filter;
      console.error(`Listing timezones${filter ? ` (filter: "${filter}")` : ""}`);
      result = listTimezones(filter);
      break;
    }
    default:
      throw new Error(`Unknown action: ${action}. Use "convert", "now", or "list".`);
  }

  console.log(JSON.stringify(result));
} catch (err: any) {
  console.error(err.message);
  console.log(JSON.stringify({ error: err.message }));
}
