/*
 * Visa Work-Hour Guard: fortnight engine (Australia, student visa condition 8105).
 *
 * Rule as quoted from the regulation (verify against the official source):
 *   48 hours per fortnight while the course is in session;
 *   "fortnight means the period of 14 days commencing on a Monday".
 * Every Monday starts a fortnight, so fortnights overlap. All must be <= the cap.
 *
 * Modes:
 *   "official": windows start on every Monday.
 *   "strict":   windows start on every day (never under-warns).
 * Hours on days inside user-entered break ranges (course not in session) are not counted.
 *
 * General information only. Not legal or migration advice.
 */
(function (root) {
  "use strict";

  const DEFAULT_RULES = { capHours: 48, windowDays: 14, anchor: "monday" };

  // Days since 1970-01-01 (UTC), so DST never shifts a date.
  function dayNum(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
  }

  function isoFromDay(n) {
    return new Date(n * 86400000).toISOString().slice(0, 10);
  }

  // 1970-01-05 (day 4) was a Monday.
  function mondayOf(n) {
    return n - (((n - 4) % 7) + 7) % 7;
  }

  function inBreak(n, breaks) {
    return breaks.some((b) => n >= b.start && n <= b.end);
  }

  // Sum in-session hours per day.
  function dailyHours(shifts, breaks) {
    const map = new Map();
    for (const s of shifts) {
      const h = Number(s.hours);
      if (!s.date || !isFinite(h) || h <= 0) continue;
      const n = dayNum(s.date);
      if (inBreak(n, breaks)) continue;
      map.set(n, (map.get(n) || 0) + h);
    }
    return map;
  }

  function normaliseBreaks(breaks) {
    return (breaks || [])
      .filter((b) => b.start && b.end)
      .map((b) => {
        const a = dayNum(b.start), z = dayNum(b.end);
        return { start: Math.min(a, z), end: Math.max(a, z) };
      });
  }

  function windowStarts(minDay, maxDay, mode, windowDays) {
    const starts = [];
    if (mode === "strict") {
      for (let s = minDay - windowDays + 1; s <= maxDay; s++) starts.push(s);
    } else {
      for (let s = mondayOf(minDay) - 7 * Math.ceil((windowDays - 7) / 7); s <= maxDay; s += 7) starts.push(s);
    }
    return starts;
  }

  /**
   * Analyse shifts.
   * @param {Array<{date:string, hours:number, job?:string}>} shifts
   * @param {{mode?:"official"|"strict", breaks?:Array<{start:string,end:string}>, rules?:object}} opts
   */
  function analyse(shifts, opts) {
    const o = opts || {};
    const rules = Object.assign({}, DEFAULT_RULES, o.rules || {});
    const mode = o.mode === "strict" ? "strict" : "official";
    const breaks = normaliseBreaks(o.breaks);
    const daily = dailyHours(shifts || [], breaks);
    const days = [...daily.keys()];
    if (!days.length) {
      return { mode, rules, windows: [], breaches: [], worst: null, totalHours: 0 };
    }
    const minDay = Math.min(...days), maxDay = Math.max(...days);
    const windows = [];
    for (const s of windowStarts(minDay, maxDay, mode, rules.windowDays)) {
      let sum = 0;
      for (let d = s; d < s + rules.windowDays; d++) sum += daily.get(d) || 0;
      if (sum > 0) {
        windows.push({
          start: isoFromDay(s),
          end: isoFromDay(s + rules.windowDays - 1),
          hours: round(sum),
          over: round(Math.max(0, sum - rules.capHours)),
          ok: sum <= rules.capHours + 1e-9,
        });
      }
    }
    const breaches = windows.filter((w) => !w.ok);
    const worst = windows.reduce((a, w) => (!a || w.hours > a.hours ? w : a), null);
    const totalHours = round([...daily.values()].reduce((a, b) => a + b, 0));
    return { mode, rules, windows, breaches, worst, totalHours };
  }

  /**
   * How many more hours can be worked on `dateIso` without breaching any window that contains it?
   * Returns Infinity if the date is inside a break.
   */
  function hoursLeftOn(dateIso, shifts, opts) {
    const o = opts || {};
    const rules = Object.assign({}, DEFAULT_RULES, o.rules || {});
    const breaks = normaliseBreaks(o.breaks);
    const n = dayNum(dateIso);
    if (inBreak(n, breaks)) return Infinity;
    const daily = dailyHours(shifts || [], breaks);
    const starts = [];
    if (o.mode === "strict") {
      for (let s = n - rules.windowDays + 1; s <= n; s++) starts.push(s);
    } else {
      for (let s = mondayOf(n); s > n - rules.windowDays; s -= 7) starts.push(s);
    }
    let maxUsed = 0;
    for (const s of starts) {
      let sum = 0;
      for (let d = s; d < s + rules.windowDays; d++) sum += daily.get(d) || 0;
      maxUsed = Math.max(maxUsed, sum);
    }
    return round(Math.max(0, rules.capHours - maxUsed));
  }

  /** Would adding this shift cause a breach? */
  function previewShift(candidate, shifts, opts) {
    const before = analyse(shifts, opts);
    const after = analyse([...(shifts || []), candidate], opts);
    return {
      safe: after.breaches.length <= before.breaches.length && !after.breaches.some((w) =>
        dayNum(candidate.date) >= dayNum(w.start) && dayNum(candidate.date) <= dayNum(w.end)),
      hoursLeft: hoursLeftOn(candidate.date, shifts, opts),
      after,
    };
  }

  function round(x) {
    return Math.round(x * 100) / 100;
  }

  const api = { analyse, hoursLeftOn, previewShift, dayNum, isoFromDay, mondayOf, DEFAULT_RULES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VisaGuard = api;
})(typeof self !== "undefined" ? self : this);
