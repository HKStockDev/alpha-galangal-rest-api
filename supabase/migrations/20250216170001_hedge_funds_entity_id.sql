alter table public.hedge_funds add column if not exists entity_id uuid unique;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hedge_funds_entity_fk') then
    alter table public.hedge_funds
      add constraint hedge_funds_entity_fk
      foreign key (entity_id) references public.entities(id);
  end if;
end
$$;
