/**
 * Format a duration in minutes to a human-readable string.
 * Examples: 30 → "30min", 60 → "1h", 90 → "1h30", 120 → "2h"
 * @param {number} minutes
 * @returns {string}
 */
export function formatDuration(minutes) {
  if (!minutes || minutes <= 0) return '-';
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${m}`;
}

/**
 * Convert backend fractional hours value to formatted string.
 * details.hours is stored as a float (e.g. 2.0, 1.5) by the backend.
 * @param {number} hours  fractional hours (e.g. 2.0, 1.5)
 * @returns {string}
 */
export function formatHours(hours) {
  if (!hours && hours !== 0) return '-';
  return formatDuration(Math.round(hours * 60));
}
