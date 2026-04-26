/**
 * Verify that the request carries a valid admin secret.
 * Set ADMIN_API_SECRET as a Supabase edge function secret.
 * The calling client (dashboard) must send:  X-Admin-Secret: <secret>
 */
export function verifyAdminSecret(req: Request): boolean {
  const secret = Deno.env.get('ADMIN_API_SECRET');
  if (!secret) return false; // Misconfigured — deny by default
  return req.headers.get('X-Admin-Secret') === secret;
}
