-- Order-level attribution without a theme script.
--
-- goself-attribution.js writes _aff_ft_ref/_aff_lt_ref note_attributes that
-- shopify-order-webhook reads to link an order back to a bg_ref — but that
-- script has to be manually added to a merchant's theme, and most merchants
-- never do it (exactly why the Web Pixel exists for click tracking).
--
-- This table is the order-level equivalent of the Web Pixel: the pixel
-- stashes {ref, checkout_token} here from the checkout_completed event
-- (via track-checkout-attribution), then shopify-order-webhook joins it back
-- to the order it just received by checkout token — no theme edits needed.

CREATE TABLE IF NOT EXISTS pending_checkout_attributions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  checkout_token text        NOT NULL,
  ref            text        NOT NULL,
  source         text,
  medium         text,
  campaign       text,
  utm_link_id    uuid        REFERENCES attribution_utm_links(id) ON DELETE SET NULL,
  partner_id     uuid        REFERENCES affiliate_partners(id) ON DELETE SET NULL,
  consumed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_checkout_attr_client_token
  ON pending_checkout_attributions (client_id, checkout_token);

CREATE INDEX IF NOT EXISTS idx_pending_checkout_attr_unconsumed
  ON pending_checkout_attributions (client_id, checkout_token) WHERE consumed_at IS NULL;

-- Enterprise security: written by the public checkout-attribution endpoint and
-- read/consumed by the order webhook, both service-role. No anon/authenticated
-- access — RLS enabled with zero policies.
ALTER TABLE pending_checkout_attributions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE pending_checkout_attributions IS
  'Staging table joining a Web Pixel checkout_completed ref report to the order shopify-order-webhook receives, keyed by checkout token. Theme-script-free order attribution.';
