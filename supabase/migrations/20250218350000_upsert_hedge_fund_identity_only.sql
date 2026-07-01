-- Redefine upsert_hedge_fund to only use identity columns (metrics live in entity_factor_values)
create or replace function public.upsert_hedge_fund(data jsonb)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.hedge_funds (
    filer_id, filer, entity_id, business_phone, fund_size,
    filer_cik, filer_zip_code, city, state, country,
    investing_styles, fund_classifications,
    earliest_13f, first_date_13f_filed, date_filed
  )
  select
    (data->>'filer_id')::integer,
    data->>'filer',
    (data->>'entity_id')::uuid,
    data->>'business_phone',
    data->>'fund_size',
    data->>'filer_cik',
    data->>'filer_zip_code',
    data->>'city',
    data->>'state',
    data->>'country',
    data->>'investing_styles',
    data->>'fund_classifications',
    (data->>'earliest_13f')::timestamptz,
    (data->>'first_date_13f_filed')::timestamptz,
    (data->>'date_filed')::timestamptz
  on conflict (filer_id) do update set
    filer = excluded.filer,
    entity_id = coalesce(excluded.entity_id, hedge_funds.entity_id),
    business_phone = excluded.business_phone,
    fund_size = excluded.fund_size,
    filer_cik = excluded.filer_cik,
    filer_zip_code = excluded.filer_zip_code,
    city = excluded.city,
    state = excluded.state,
    country = excluded.country,
    investing_styles = excluded.investing_styles,
    fund_classifications = excluded.fund_classifications,
    earliest_13f = excluded.earliest_13f,
    first_date_13f_filed = excluded.first_date_13f_filed,
    date_filed = excluded.date_filed;
end;
$$;
