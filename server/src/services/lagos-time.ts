function calendarDate(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new RangeError("Invalid calendar day");
  const value = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== day) throw new RangeError("Invalid calendar day");
  return value;
}

function localMidnight(utc: Date) {
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Lagos", timeZoneName: "longOffset" })
    .formatToParts(utc).find(part => part.type === "timeZoneName")?.value;
  if (offset === "GMT") return utc;
  const match = /^GMT([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(offset ?? "");
  if (!match) throw new RangeError("Lagos time zone is unavailable");
  const seconds = Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4] ?? 0);
  return new Date(utc.getTime() - (match[1] === "+" ? seconds : -seconds) * 1000);
}

export function lagosDayRange(day: string) {
  const date = calendarDate(day);
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return { start: localMidnight(date), end: localMidnight(next) };
}

export function validCalendarDay(day: string) {
  try { calendarDate(day); return true; } catch { return false; }
}
