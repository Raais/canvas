import * as chrono from 'chrono-node';

export type DateRange = {
  start: number;
  end: number;
  label: string;
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'] as const;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

export function interpretDateQuery(raw: string, now: Date): { range: DateRange | null; dateOnly: boolean; invalid: boolean; content: string } {
  const query = raw.trim().replace(/\s+/g, ' ');
  const explicit = query.match(/^edited:\s*(.*)$/i);
  const phrase = (explicit ? explicit[1] : query).trim();
  const dateOnly = Boolean(explicit);
  if (!phrase) return { range: null, dateOnly, invalid: dateOnly, content: dateOnly ? '' : query };
  const range = explicitRange(phrase, now) ?? chronoRange(phrase, now);
  if (!range) return { range: null, dateOnly, invalid: dateOnly, content: dateOnly ? '' : query };
  return { range, dateOnly, invalid: false, content: dateOnly ? '' : query };
}

function explicitRange(phrase: string, now: Date): DateRange | null {
  const text = phrase.toLowerCase();
  if (text === 'today') return dayRange(startOfDay(now), 'TODAY');
  if (text === 'yesterday') return dayRange(addDays(startOfDay(now), -1), 'YESTERDAY');
  const weekday = text.match(/^last (sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (weekday) {
    const index = WEEKDAYS.indexOf(weekday[1] as (typeof WEEKDAYS)[number]);
    return dayRange(previousWeekday(now, index), `LAST ${weekday[1].toUpperCase()}`);
  }
  if (text === 'this week') {
    const start = startOfWeek(now);
    return span(start, addDays(start, 7), 'THIS WEEK');
  }
  if (text === 'last week') {
    const start = addDays(startOfWeek(now), -7);
    return span(start, addDays(start, 7), 'LAST WEEK');
  }
  const past = text.match(/^past (\d+) days$/);
  if (past) {
    const count = Number(past[1]);
    if (count <= 0) return null;
    const end = addDays(startOfDay(now), 1);
    return span(addDays(end, -count), end, `PAST ${count} DAYS`);
  }
  const ago = text.match(/^(one|two|three|four|five|six|seven|eight|nine|ten|\d+) days ago$/);
  if (ago) {
    const count = WORDS[ago[1]] ?? Number(ago[1]);
    if (!Number.isInteger(count) || count < 0) return null;
    return dayRange(addDays(startOfDay(now), -count), `${count} DAYS AGO`);
  }
  const month = text.match(/^(january|february|march|april|may|june|july|august|september|october|november|december)(?: (\d{4}))?$/);
  if (month) {
    const monthIndex = MONTHS.indexOf(month[1] as (typeof MONTHS)[number]);
    const year = month[2] ? Number(month[2]) : mostRecentYear(now, monthIndex);
    if (year < 1 || year > 9999) return null;
    const start = new Date(year, monthIndex, 1);
    return span(start, new Date(year, monthIndex + 1, 1), `${month[1].toUpperCase()} ${year}`);
  }
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (slash) {
    const day = Number(slash[1]);
    const monthIndex = Number(slash[2]) - 1;
    if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
    const year = slash[3] ? Number(slash[3]) : mostRecentDay(now, monthIndex, day);
    const start = new Date(year, monthIndex, day);
    if (start.getFullYear() !== year || start.getMonth() !== monthIndex || start.getDate() !== day) return null;
    const label = slash[3] ? `${pad(day)}/${pad(monthIndex + 1)}/${year}` : `${pad(day)}/${pad(monthIndex + 1)}`;
    return dayRange(start, label);
  }
  const yearOnly = text.match(/^(\d{4})$/);
  if (yearOnly) {
    const year = Number(yearOnly[1]);
    if (year < 1) return null;
    return span(new Date(year, 0, 1), new Date(year + 1, 0, 1), String(year));
  }
  return null;
}

function chronoRange(phrase: string, now: Date): DateRange | null {
  const parsed = chrono.parse(phrase, now, { forwardDate: false });
  if (parsed.length !== 1) return null;
  const result = parsed[0];
  if (result.index !== 0 || result.text.trim().length !== phrase.length) return null;
  const start = result.start;
  if (start.isCertain('year') && !start.isCertain('month')) {
    const year = start.get('year');
    if (year == null) return null;
    return span(new Date(year, 0, 1), new Date(year + 1, 0, 1), String(year));
  }
  if (start.isCertain('month') && !start.isCertain('day')) {
    const year = start.get('year') ?? mostRecentYear(now, start.get('month')! - 1);
    const monthIndex = start.get('month')! - 1;
    return span(new Date(year, monthIndex, 1), new Date(year, monthIndex + 1, 1), `${MONTHS[monthIndex]?.toUpperCase() ?? 'MONTH'} ${year}`);
  }
  if (start.isCertain('day') || start.isCertain('weekday')) {
    const date = startOfDay(start.date());
    return dayRange(date, 'DATE');
  }
  return null;
}

function mostRecentYear(now: Date, monthIndex: number): number {
  return now.getMonth() < monthIndex ? now.getFullYear() - 1 : now.getFullYear();
}

function mostRecentDay(now: Date, monthIndex: number, day: number): number {
  const year = now.getFullYear();
  const candidate = new Date(year, monthIndex, day);
  if (candidate.getMonth() !== monthIndex) return year;
  const today = startOfDay(now).getTime();
  return candidate.getTime() <= today ? year : year - 1;
}

function previousWeekday(now: Date, weekday: number): Date {
  const current = now.getDay();
  let delta = (current - weekday + 7) % 7;
  if (delta === 0) delta = 7;
  return addDays(startOfDay(now), -delta);
}

function startOfWeek(now: Date): Date {
  const day = now.getDay();
  const monday = day === 0 ? -6 : 1 - day;
  return addDays(startOfDay(now), monday);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function dayRange(start: Date, label: string): DateRange {
  return span(start, addDays(start, 1), label);
}

function span(start: Date, end: Date, label: string): DateRange {
  return { start: start.getTime(), end: end.getTime(), label };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
