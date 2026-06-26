// Scheduling primitives: timezone, holidays, business-day roll-forward, staggering.
// All wall-clock math is anchored to America/Indiana/Indianapolis.
const { DateTime } = require('luxon');

const ZONE = 'America/Indiana/Indianapolis';

function nowLocal() {
  return DateTime.now().setZone(ZONE);
}

// nth weekday of a month, e.g. nthWeekday(year, 5, 1, -1) = last Monday of May
function nthWeekday(year, month, weekday, n) {
  if (n > 0) {
    let d = DateTime.fromObject({ year, month, day: 1 }, { zone: ZONE });
    const offset = (weekday - d.weekday + 7) % 7;
    return d.plus({ days: offset + (n - 1) * 7 });
  }
  // n < 0 counts from the end of the month
  let d = DateTime.fromObject({ year, month, day: 1 }, { zone: ZONE }).endOf('month').startOf('day');
  const offset = (d.weekday - weekday + 7) % 7;
  return d.minus({ days: offset + (-n - 1) * 7 });
}

// The holidays we never send on (Andrew's list).
function holidaySet(year) {
  const thanksgiving = nthWeekday(year, 11, 4, 4); // 4th Thursday of November
  const days = [
    DateTime.fromObject({ year, month: 1, day: 1 }, { zone: ZONE }),   // New Year's Day
    nthWeekday(year, 5, 1, -1),                                         // Memorial Day (last Mon May)
    DateTime.fromObject({ year, month: 7, day: 4 }, { zone: ZONE }),    // Independence Day
    nthWeekday(year, 9, 1, 1),                                          // Labor Day (1st Mon Sep)
    thanksgiving,                                                       // Thanksgiving
    thanksgiving.plus({ days: 1 }),                                     // Friday after Thanksgiving
    DateTime.fromObject({ year, month: 12, day: 24 }, { zone: ZONE }),  // Christmas Eve
    DateTime.fromObject({ year, month: 12, day: 25 }, { zone: ZONE }),  // Christmas Day
  ];
  return new Set(days.map((d) => d.toISODate()));
}

function isHoliday(dt) {
  return holidaySet(dt.year).has(dt.toISODate());
}

function isWeekend(dt) {
  return dt.weekday === 6 || dt.weekday === 7; // Sat or Sun
}

function isBusinessDay(dt) {
  return !isWeekend(dt) && !isHoliday(dt);
}

// Roll a DateTime forward to the next business day. If it's already a business
// day but outside the send window, it stays that day (the engine sends when due);
// if it's a weekend/holiday OR after the window closes, move to the next business
// morning at sendWindowStart.
function rollForward(dt, sendWindowStart = 8, sendWindowEnd = 16) {
  let d = dt;
  // If past today's window, push to tomorrow morning before checking business day.
  if (d.hour >= sendWindowEnd) {
    d = d.plus({ days: 1 }).set({ hour: sendWindowStart, minute: 0, second: 0, millisecond: 0 });
  } else if (d.hour < sendWindowStart) {
    d = d.set({ hour: sendWindowStart, minute: 0, second: 0, millisecond: 0 });
  }
  while (!isBusinessDay(d)) {
    d = d.plus({ days: 1 }).set({ hour: sendWindowStart, minute: 0, second: 0, millisecond: 0 });
  }
  return d;
}

// Push a single day's events to the next business day (calendar feature).
function nextBusinessDay(dt, sendWindowStart = 8) {
  let d = dt.plus({ days: 1 }).set({ hour: sendWindowStart, minute: 0, second: 0, millisecond: 0 });
  while (!isBusinessDay(d)) {
    d = d.plus({ days: 1 });
  }
  return d;
}

module.exports = {
  ZONE,
  DateTime,
  nowLocal,
  isBusinessDay,
  isHoliday,
  isWeekend,
  rollForward,
  nextBusinessDay,
};
