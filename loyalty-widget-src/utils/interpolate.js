/**
 * interpolate — GoSelf Loyalty Widget V6
 * Replaces {key} placeholders in a string with values from a vars object.
 *
 * Usage: interpolate("Hi {firstName} 👋", { firstName: "Priya" }) → "Hi Priya 👋"
 */
export const interpolate = (str, vars) =>
  String(str || '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
