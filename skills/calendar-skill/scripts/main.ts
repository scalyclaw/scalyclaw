import ICAL from "ical.js";
import { DateTime, Interval } from "luxon";
import { readFileSync, existsSync } from "fs";

try {
  const data = await Bun.stdin.json();
  const action: string = data.action;

  if (!action || !["parse", "range"].includes(action)) {
    throw new Error("Parameter 'action' must be 'parse' or 'range'");
  }

  if (action === "parse") {
    let icalData: string;

    if (data.file_path) {
      if (!existsSync(data.file_path)) {
        throw new Error(`File not found: ${data.file_path}`);
      }
      icalData = readFileSync(data.file_path, "utf-8");
      console.error(`Read iCal file: ${data.file_path}`);
    } else if (data.ical_data) {
      icalData = data.ical_data;
      console.error(`Parsing iCal data (${icalData.length} chars)`);
    } else {
      throw new Error("Either 'ical_data' or 'file_path' must be provided for parse action");
    }

    const jcalData = ICAL.parse(icalData);
    const comp = new ICAL.Component(jcalData);
    const vevents = comp.getAllSubcomponents("vevent");

    const events = vevents.map((vevent: any) => {
      const event = new ICAL.Event(vevent);
      return {
        summary: event.summary || null,
        start: event.startDate ? event.startDate.toString() : null,
        end: event.endDate ? event.endDate.toString() : null,
        location: event.location || null,
        description: event.description || null,
        uid: event.uid || null,
        status: vevent.getFirstPropertyValue("status") || null,
        organizer: vevent.getFirstPropertyValue("organizer") || null,
      };
    });

    console.error(`Found ${events.length} events`);
    console.log(JSON.stringify({ events, event_count: events.length }));
  } else {
    const startDate: string = data.start_date;
    const endDate: string = data.end_date;
    const unit: string = data.unit || "days";

    if (!startDate) throw new Error("Missing required parameter: start_date");
    if (!endDate) throw new Error("Missing required parameter: end_date");
    if (!["days", "weeks", "months"].includes(unit)) {
      throw new Error("Parameter 'unit' must be 'days', 'weeks', or 'months'");
    }

    const start = DateTime.fromISO(startDate);
    const end = DateTime.fromISO(endDate);

    if (!start.isValid) throw new Error(`Invalid start_date: ${startDate}`);
    if (!end.isValid) throw new Error(`Invalid end_date: ${endDate}`);

    const interval = Interval.fromDateTimes(start, end);
    let diff: number;

    switch (unit) {
      case "days":
        diff = interval.length("days");
        break;
      case "weeks":
        diff = interval.length("weeks");
        break;
      case "months":
        diff = interval.length("months");
        break;
      default:
        diff = interval.length("days");
    }

    diff = Math.round(diff * 100) / 100;

    console.error(`Date range: ${startDate} to ${endDate} = ${diff} ${unit}`);
    console.log(
      JSON.stringify({
        diff,
        unit,
        start: start.toISO(),
        end: end.toISO(),
      })
    );
  }
} catch (err: any) {
  console.error(err.message);
  console.log(JSON.stringify({ error: err.message }));
}
