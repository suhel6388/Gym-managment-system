// Server-side date/time helpers used by the subscription expiry and
// reconciliation logic. All functions are pure so they can be unit-tested
// without a database.

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Add whole months to a date, clamping the day to the end of the target month
 * (e.g. Jan 31 + 1 month = Feb 28/29). Uses UTC to stay deterministic.
 */
export function addMonthsClamped(date, months) {
  const d = new Date(date.getTime());
  const targetMonth = d.getUTCMonth() + months;
  const targetYear = d.getUTCFullYear() + Math.floor(targetMonth / 12);
  const monthInYear = ((targetMonth % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, monthInYear + 1, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), daysInTargetMonth);
  return new Date(
    Date.UTC(targetYear, monthInYear, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()),
  );
}

/** Add whole days to a date. */
export function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * Whole days remaining until `endDate`, rounded up, never negative.
 * Returns 0 when endDate is null or in the past.
 */
export function daysRemaining(endDate, now = new Date()) {
  if (!endDate) return 0;
  const diff = endDate.getTime() - now.getTime();
  if (diff <= 0) return 0;
  return Math.ceil(diff / DAY_MS);
}

/** True when the date is strictly in the future (after `now`). */
export function isFuture(date, now = new Date()) {
  return Boolean(date) && date.getTime() > now.getTime();
}
