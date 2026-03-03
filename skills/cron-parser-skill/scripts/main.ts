import parser from "cron-parser";

const DAY_NAMES: Record<string, string> = {
  "0": "Sunday",
  "1": "Monday",
  "2": "Tuesday",
  "3": "Wednesday",
  "4": "Thursday",
  "5": "Friday",
  "6": "Saturday",
  "7": "Sunday",
};

const MONTH_NAMES: Record<string, string> = {
  "1": "January",
  "2": "February",
  "3": "March",
  "4": "April",
  "5": "May",
  "6": "June",
  "7": "July",
  "8": "August",
  "9": "September",
  "10": "October",
  "11": "November",
  "12": "December",
};

function describeCron(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  // Handle 6-field (with seconds) by dropping the first field
  const fields = parts.length === 6 ? parts.slice(1) : parts.slice(0, 5);
  if (fields.length !== 5) return expression;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;

  // Every minute
  if (minute === "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return "Every minute";
  }

  // Every N minutes: */N * * * *
  const everyNMin = minute.match(/^\*\/(\d+)$/);
  if (everyNMin && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const n = parseInt(everyNMin[1]);
    return n === 1 ? "Every minute" : `Every ${n} minutes`;
  }

  // Every N hours: 0 */N * * *
  const everyNHour = hour.match(/^\*\/(\d+)$/);
  if (minute === "0" && everyNHour && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const n = parseInt(everyNHour[1]);
    return n === 1 ? "Every hour" : `Every ${n} hours`;
  }

  // Every hour at minute M: M * * * *
  if (/^\d+$/.test(minute) && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Every hour at minute ${minute}`;
  }

  // Build time string for specific hour/minute
  const formatTime = (h: string, m: string): string => {
    const hh = h.padStart(2, "0");
    const mm = m.padStart(2, "0");
    return `${hh}:${mm}`;
  };

  const hasSpecificTime = /^\d+$/.test(minute) && /^\d+$/.test(hour);

  if (hasSpecificTime) {
    const timeStr = formatTime(hour, minute);

    // Daily: M H * * *
    if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
      return `At ${timeStr} every day`;
    }

    // Specific day(s) of week: M H * * D
    if (dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
      const dayDesc = describeDaysOfWeek(dayOfWeek);
      return `At ${timeStr} on ${dayDesc}`;
    }

    // Specific day of month: M H D * *
    if (/^\d+$/.test(dayOfMonth) && month === "*" && dayOfWeek === "*") {
      return `At ${timeStr} on day ${dayOfMonth} of every month`;
    }

    // Specific month and day: M H D Mo *
    if (/^\d+$/.test(dayOfMonth) && /^\d+$/.test(month) && dayOfWeek === "*") {
      const monthName = MONTH_NAMES[String(parseInt(month))] || `month ${month}`;
      return `At ${timeStr} on ${monthName} ${parseInt(dayOfMonth)}`;
    }

    // Midnight/noon shortcuts
    if (minute === "0" && hour === "0" && dayOfMonth === "*" && month === "*") {
      if (dayOfWeek === "*") return "At midnight every day";
      return `At midnight on ${describeDaysOfWeek(dayOfWeek)}`;
    }
  }

  // Fallback: build a descriptive string from the parts
  const pieces: string[] = [];

  if (hasSpecificTime) {
    pieces.push(`At ${formatTime(hour, minute)}`);
  } else {
    if (everyNMin) pieces.push(`every ${everyNMin[1]} minutes`);
    else if (minute !== "*") pieces.push(`at minute ${minute}`);

    if (everyNHour) pieces.push(`every ${everyNHour[1]} hours`);
    else if (hour !== "*") pieces.push(`at hour ${hour}`);
  }

  if (dayOfMonth !== "*") pieces.push(`on day ${dayOfMonth} of the month`);
  if (month !== "*") {
    const monthName = MONTH_NAMES[String(parseInt(month))] || `month ${month}`;
    pieces.push(`in ${monthName}`);
  }
  if (dayOfWeek !== "*") pieces.push(`on ${describeDaysOfWeek(dayOfWeek)}`);

  return pieces.length > 0 ? pieces.join(" ") : expression;
}

function describeDaysOfWeek(field: string): string {
  // Handle ranges: 1-5 -> Monday through Friday
  const rangeMatch = field.match(/^(\d)-(\d)$/);
  if (rangeMatch) {
    const start = DAY_NAMES[rangeMatch[1]];
    const end = DAY_NAMES[rangeMatch[2]];
    if (start && end) return `${start} through ${end}`;
  }

  // Handle lists: 1,3,5 -> Monday, Wednesday, and Friday
  if (field.includes(",")) {
    const days = field.split(",").map((d) => DAY_NAMES[d.trim()] || d.trim());
    if (days.length === 2) return `${days[0]} and ${days[1]}`;
    return days.slice(0, -1).join(", ") + ", and " + days[days.length - 1];
  }

  // Single day
  return DAY_NAMES[field] || field;
}

let inputExpression: string | undefined;

try {
  const data = await Bun.stdin.json();

  inputExpression = data.expression;
  if (!inputExpression) {
    throw new Error("Missing required parameter: expression");
  }

  const expression = inputExpression;

  const count: number = data.count ?? 5;
  const timezone: string = data.timezone || "UTC";
  const from: string | undefined = data.from;

  console.error(`Parsing cron expression: ${expression} (tz: ${timezone}, count: ${count})`);

  // Parse the expression
  const options: Record<string, any> = { tz: timezone };
  if (from) {
    options.currentDate = new Date(from);
  }

  const interval = parser.parseExpression(expression, options);

  // Calculate next N runs
  const nextRuns: string[] = [];
  for (let i = 0; i < count; i++) {
    try {
      const next = interval.next();
      nextRuns.push(next.toISOString());
    } catch {
      break; // No more iterations available
    }
  }

  // Extract fields from expression
  const parts = expression.trim().split(/\s+/);
  let fields: Record<string, string>;
  if (parts.length === 6) {
    // 6-field expression (with seconds)
    fields = {
      second: parts[0],
      minute: parts[1],
      hour: parts[2],
      day_of_month: parts[3],
      month: parts[4],
      day_of_week: parts[5],
    };
  } else {
    fields = {
      minute: parts[0] || "*",
      hour: parts[1] || "*",
      day_of_month: parts[2] || "*",
      month: parts[3] || "*",
      day_of_week: parts[4] || "*",
    };
  }

  // Generate human-readable description
  const description = describeCron(expression);

  console.log(
    JSON.stringify({
      expression,
      description,
      next_runs: nextRuns,
      fields,
      is_valid: true,
    })
  );
} catch (err: any) {
  const message = err.message || String(err);

  // If it's a parse error, return structured invalid response
  if (message.includes("Missing required parameter")) {
    console.error(message);
    console.log(JSON.stringify({ error: message }));
  } else {
    console.error(`Invalid cron expression: ${message}`);
    console.log(
      JSON.stringify({
        expression: inputExpression || "unknown",
        is_valid: false,
        error: message,
      })
    );
  }
}
