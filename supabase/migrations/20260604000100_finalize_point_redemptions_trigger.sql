-- Redeem-at-Checkout finalization (reserve -> applied) as an idempotent trigger.
--
-- When shopify-order-webhook upserts an order into shopify_orders with a paid
-- status, this trigger looks at the discount codes on the order and, for any
-- that match a still-'reserved' point_redemption_hold for the same client,
-- atomically claims the hold (reserved -> applied) and deducts the reserved
-- points from the member's balance — recording a 'redeemed' transaction.
--
-- Idempotency: the claim is an UPDATE ... WHERE status='reserved' RETURNING.
-- The webhook upserts the same order row on every topic (create, paid, ...), so
-- the trigger may fire multiple times; only the first paid pass with a reserved
-- hold deducts. Subsequent fires find the hold 'applied' and skip.
--
-- Abandoned checkouts never reach a paid order, so their holds simply expire
-- with no points moved.

CREATE OR REPLACE FUNCTION finalize_point_redemptions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code   text;
  v_hold   point_redemption_holds%ROWTYPE;
  v_deduct integer;
  v_bal    integer;
BEGIN
  -- Only act on paid orders.
  IF NOT (NEW.financial_status = 'paid' OR NEW.order_status = 'paid') THEN
    RETURN NEW;
  END IF;
  IF NEW.order_data IS NULL THEN
    RETURN NEW;
  END IF;

  FOR v_code IN
    SELECT DISTINCT upper(trim(code)) AS code
    FROM (
      SELECT jsonb_array_elements(coalesce(NEW.order_data->'discount_codes', '[]'::jsonb))->>'code' AS code
      UNION ALL
      SELECT jsonb_array_elements(coalesce(NEW.order_data->'discount_applications', '[]'::jsonb))->>'code' AS code
    ) c
    WHERE code IS NOT NULL AND length(trim(code)) > 0
  LOOP
    -- Atomically claim the hold (idempotency guard).
    UPDATE point_redemption_holds
       SET status = 'applied',
           order_id = NEW.shopify_order_id,
           applied_at = now(),
           updated_at = now()
     WHERE client_id = NEW.client_id
       AND discount_code = v_code
       AND status = 'reserved'
    RETURNING * INTO v_hold;

    IF NOT FOUND THEN
      CONTINUE; -- not a redemption code, or already finalized
    END IF;

    -- Lock the member status row, deduct (capped at current balance).
    SELECT points_balance INTO v_bal
      FROM member_loyalty_status
     WHERE id = v_hold.member_loyalty_status_id
     FOR UPDATE;
    IF v_bal IS NULL THEN
      CONTINUE;
    END IF;

    v_deduct := least(v_hold.points_reserved, greatest(v_bal, 0));
    v_bal := v_bal - v_deduct;

    UPDATE member_loyalty_status
       SET points_balance = v_bal,
           lifetime_points_redeemed = coalesce(lifetime_points_redeemed, 0) + v_deduct,
           updated_at = now()
     WHERE id = v_hold.member_loyalty_status_id;

    INSERT INTO loyalty_points_transactions
      (member_loyalty_status_id, member_user_id, transaction_type, points_amount, balance_after, reference_id, description)
    VALUES
      (v_hold.member_loyalty_status_id, v_hold.member_user_id, 'redeemed', -v_deduct, v_bal, NEW.shopify_order_id,
       'Points redeemed at checkout (code ' || v_code || ') on order ' || coalesce(NEW.order_number, '#' || NEW.shopify_order_id));
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_finalize_point_redemptions ON shopify_orders;
CREATE TRIGGER trg_finalize_point_redemptions
AFTER INSERT OR UPDATE ON shopify_orders
FOR EACH ROW
EXECUTE FUNCTION finalize_point_redemptions();
