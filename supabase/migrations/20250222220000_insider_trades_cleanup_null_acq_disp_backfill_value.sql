-- Remove insider_trades with null acquisition_or_disposition; backfill value_usd from shares * price_usd where missing.

DELETE FROM public.insider_trades
WHERE acquisition_or_disposition IS NULL;

UPDATE public.insider_trades
SET value_usd = ROUND((shares * price_usd)::numeric, 2)
WHERE value_usd IS NULL
  AND price_usd IS NOT NULL
  AND shares IS NOT NULL;
