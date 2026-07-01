-- CON-155 phase 0: monthly base credits, seeds, consume RPC, pack purchase idempotency.

BEGIN;

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS monthly_base_credits integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.subscription_plans.monthly_base_credits IS
  'Base credits granted each billing cycle (no carryover).';

UPDATE public.subscription_plans SET monthly_base_credits = CASE
  WHEN plan_key LIKE 'professional%' THEN 500
  WHEN plan_key LIKE 'team%' THEN 1000
  WHEN plan_key LIKE 'enterprise%' THEN 5000
  WHEN plan_key LIKE 'trial%' THEN 100
  ELSE monthly_base_credits
END
WHERE monthly_base_credits = 0;

INSERT INTO public.ai_capability_credit_costs (capability_key, credits_cost, is_enabled)
SELECT capability_key,
  CASE capability_key
    WHEN 'chat.global' THEN 2
    WHEN 'chat.client' THEN 2
    WHEN 'formula.create' THEN 5
    WHEN 'screen.run' THEN 2
    WHEN 'formula.explain' THEN 1
    WHEN 'watchlist.create' THEN 1
    WHEN 'watchlist.create_from_screen' THEN 2
    ELSE 0
  END,
  CASE
    WHEN capability_key IN ('chat.global', 'chat.client', 'formula.create', 'screen.run') THEN true
    ELSE false
  END
FROM public.ai_capabilities
ON CONFLICT (capability_key) DO NOTHING;

INSERT INTO public.credit_packs (
  pack_key,
  name,
  credits_amount,
  stripe_product_id,
  stripe_price_id,
  currency,
  unit_amount_cents,
  is_active,
  sort_order
)
VALUES
  (
    'pack_500',
    '500 Credit Pack',
    500,
    'prod_SEEDPH2REPLACE_CREDITS_500',
    'price_SEEDPH2REPLACE_CREDITS_500',
    'usd',
    4900,
    false,
    10
  ),
  (
    'pack_2000',
    '2,000 Credit Pack',
    2000,
    'prod_SEEDPH2REPLACE_CREDITS_2000',
    'price_SEEDPH2REPLACE_CREDITS_2000',
    'usd',
    14900,
    false,
    20
  ),
  (
    'pack_10000',
    '10,000 Credit Pack',
    10000,
    'prod_SEEDPH2REPLACE_CREDITS_10000',
    'price_SEEDPH2REPLACE_CREDITS_10000',
    'usd',
    49900,
    false,
    30
  )
ON CONFLICT (pack_key) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_lots_stripe_checkout_session
  ON public.organization_credit_lots(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.consume_org_credits(
  p_organization_id uuid,
  p_capability_key text,
  p_reference_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_cost integer;
  v_enabled boolean;
  v_wallet public.organization_credit_wallets%ROWTYPE;
  v_need integer;
  v_from_base integer;
  v_from_lot integer;
  v_lot public.organization_credit_lots%ROWTYPE;
BEGIN
  SELECT credits_cost, is_enabled INTO v_cost, v_enabled
  FROM public.ai_capability_credit_costs
  WHERE capability_key = p_capability_key;

  IF NOT FOUND OR NOT COALESCE(v_enabled, false) OR COALESCE(v_cost, 0) <= 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'disabled_or_zero');
  END IF;

  SELECT * INTO v_wallet
  FROM public.organization_credit_wallets
  WHERE organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'error', 'insufficient_credits',
      'required_credits', v_cost,
      'remaining_credits', 0
    );
  END IF;

  IF v_wallet.base_credits_remaining + v_wallet.pack_credits_remaining < v_cost THEN
    RETURN jsonb_build_object(
      'error', 'insufficient_credits',
      'required_credits', v_cost,
      'remaining_credits', v_wallet.base_credits_remaining + v_wallet.pack_credits_remaining
    );
  END IF;

  v_need := v_cost;

  v_from_base := LEAST(v_need, v_wallet.base_credits_remaining);
  IF v_from_base > 0 THEN
    UPDATE public.organization_credit_wallets
    SET
      base_credits_remaining = base_credits_remaining - v_from_base,
      last_consumed_at = now(),
      updated_at = now()
    WHERE id = v_wallet.id;

    INSERT INTO public.organization_credit_transactions (
      organization_id,
      wallet_id,
      tx_type,
      bucket_type,
      credits_delta,
      capability_key,
      reference_id
    ) VALUES (
      p_organization_id,
      v_wallet.id,
      'consume',
      'base',
      -v_from_base,
      p_capability_key,
      p_reference_id
    );

    v_need := v_need - v_from_base;
  END IF;

  WHILE v_need > 0 LOOP
    SELECT * INTO v_lot
    FROM public.organization_credit_lots
    WHERE organization_id = p_organization_id
      AND remaining_credits > 0
      AND expires_at > now()
    ORDER BY expires_at ASC, id ASC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'pack_debit_inconsistent for org %', p_organization_id;
    END IF;

    v_from_lot := LEAST(v_need, v_lot.remaining_credits);

    UPDATE public.organization_credit_lots
    SET remaining_credits = remaining_credits - v_from_lot, updated_at = now()
    WHERE id = v_lot.id;

    UPDATE public.organization_credit_wallets
    SET
      pack_credits_remaining = pack_credits_remaining - v_from_lot,
      last_consumed_at = now(),
      updated_at = now()
    WHERE id = v_wallet.id;

    INSERT INTO public.organization_credit_transactions (
      organization_id,
      wallet_id,
      lot_id,
      tx_type,
      bucket_type,
      credits_delta,
      capability_key,
      reference_id
    ) VALUES (
      p_organization_id,
      v_wallet.id,
      v_lot.id,
      'consume',
      'pack',
      -v_from_lot,
      p_capability_key,
      p_reference_id
    );

    v_need := v_need - v_from_lot;
  END LOOP;

  SELECT * INTO v_wallet
  FROM public.organization_credit_wallets
  WHERE id = v_wallet.id;

  RETURN jsonb_build_object(
    'consumed', v_cost,
    'remaining_credits', v_wallet.base_credits_remaining + v_wallet.pack_credits_remaining
  );
END;
$$;

COMMIT;
