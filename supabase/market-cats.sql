-- Market categories are now only 'ingredient' or 'decoration' (run once on an EXISTING database; safe to re-run).
update public.market_items set category = 'ingredient' where category not in ('ingredient', 'decoration');
