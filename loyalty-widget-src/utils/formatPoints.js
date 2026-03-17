/**
 * formatPoints — GoSelf Loyalty Widget V6
 * Formats a points integer with the configured abbreviation.
 *
 * Usage: formatPoints(4280, config) → "4,280 pts"
 */
export const formatPoints = (n, cfg) =>
  `${Number(n).toLocaleString('en-IN')} ${cfg?.pointsAbbrev || 'pts'}`;
