-- resolve_or_create_member — robust, concurrency-safe member resolution by
-- email OR phone, used by shopify-order-webhook (and reusable elsewhere).
--
-- WHY: the webhook previously did
--   .upsert(..., { onConflict: 'client_id,email' })
-- but the only matching unique index is PARTIAL
--   member_users_client_id_email_key ON (client_id,email) WHERE email IS NOT NULL AND email <> ''
-- and PostgreSQL refuses a partial index as an ON CONFLICT arbiter unless the
-- statement repeats the predicate (which supabase-js cannot express) -> 42P10.
-- The webhook swallowed that error and returned HTTP 500 "Failed to find or
-- create member" for any customer not already enrolled, so first-touch-by-order
-- customers never got points and Shopify retried the 500 forever.
--
-- Raw SQL CAN name the partial-index predicate in ON CONFLICT, so this function
-- fixes the 42P10 failure AND adds phone-only identity (DO UPDATE guarantees
-- RETURNING yields the id even on conflict).

CREATE OR REPLACE FUNCTION public.resolve_or_create_member(
  p_client_id   uuid,
  p_email       text,
  p_phone       text,
  p_name        text,
  p_external_id text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id    uuid;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_name  text := nullif(trim(coalesce(p_name,  '')), '');
BEGIN
  IF v_email IS NOT NULL THEN
    INSERT INTO member_users (client_id, email, phone, full_name, external_id, is_active)
    VALUES (p_client_id, v_email, v_phone, coalesce(v_name, v_email), p_external_id, true)
    ON CONFLICT (client_id, email) WHERE (email IS NOT NULL AND email <> '')
    DO UPDATE SET
      phone       = COALESCE(member_users.phone, EXCLUDED.phone),
      external_id = COALESCE(member_users.external_id, EXCLUDED.external_id),
      updated_at  = now()
    RETURNING id INTO v_id;
    RETURN v_id;

  ELSIF v_phone IS NOT NULL THEN
    INSERT INTO member_users (client_id, email, phone, full_name, external_id, is_active)
    VALUES (p_client_id, NULL, v_phone, coalesce(v_name, v_phone), p_external_id, true)
    ON CONFLICT (client_id, phone) WHERE (phone IS NOT NULL AND phone <> '')
    DO UPDATE SET
      external_id = COALESCE(member_users.external_id, EXCLUDED.external_id),
      updated_at  = now()
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  -- Neither email nor phone supplied -> caller records the order, awards nothing.
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_or_create_member(uuid, text, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_or_create_member(uuid, text, text, text, text) TO service_role;
