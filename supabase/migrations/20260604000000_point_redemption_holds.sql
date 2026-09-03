-- Redeem-at-Checkout: reserve model for spending points as a checkout discount.
--
-- When a member redeems points at checkout we create a single-use, short-lived
-- Shopify discount code and RESERVE the points here (status='reserved').
-- No balance is deducted at reserve time. Points are deducted only when the
-- order is actually paid AND the reserved code was used on that order — this is
-- finalized idempotently in the shopify-order-webhook (status -> 'applied').
--
-- Abandoned checkouts cost nothing: the hold simply expires, no points moved.
-- Concurrent holds are accounted against an "available balance" so a member can
-- never reserve more than they hold across multiple in-flight checkouts.

CREATE TABLE IF NOT EXISTS point_redemption_holds (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                 uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  member_user_id            uuid        NOT NULL REFERENCES member_users(id) ON DELETE CASCADE,
  member_loyalty_status_id  uuid        NOT NULL REFERENCES member_loyalty_status(id) ON DELETE CASCADE,
  shop_domain               text        NOT NULL,
  discount_code             text        NOT NULL,
  shopify_price_rule_id     text,
  points_reserved           integer     NOT NULL CHECK (points_reserved > 0),
  discount_value            numeric     NOT NULL CHECK (discount_value > 0),
  currency                  text,
  status                    text        NOT NULL DEFAULT 'reserved'
                                        CHECK (status IN ('reserved','applied','expired','cancelled')),
  order_id                  text,
  expires_at                timestamptz NOT NULL,
  applied_at                timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- A discount code is unique within a client (used for webhook finalization lookup).
CREATE UNIQUE INDEX IF NOT EXISTS uq_redemption_holds_client_code
  ON point_redemption_holds (client_id, discount_code);

-- Fast "outstanding reserved points for this member" accounting.
CREATE INDEX IF NOT EXISTS idx_redemption_holds_status_member
  ON point_redemption_holds (member_loyalty_status_id, status);

-- Fast finalize lookup by client + still-reserved.
CREATE INDEX IF NOT EXISTS idx_redemption_holds_client_reserved
  ON point_redemption_holds (client_id, status) WHERE status = 'reserved';

-- Enterprise security: holds reference member balances and are written/read ONLY
-- by edge functions using the service role. Enable RLS with NO policies so anon /
-- authenticated roles have zero access; service_role bypasses RLS.
ALTER TABLE point_redemption_holds ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE point_redemption_holds IS
  'Reserve-model holds for redeeming loyalty points as a Shopify checkout discount. Points deducted only on paid order via shopify-order-webhook finalization.';
