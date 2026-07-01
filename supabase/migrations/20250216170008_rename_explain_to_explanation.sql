do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'entity_scores_current' and column_name = 'explain'
  ) then
    alter table public.entity_scores_current rename column explain to explanation;
  end if;
end $$;
