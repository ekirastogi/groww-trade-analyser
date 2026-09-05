-- Additional Screener financial statement tables (balance sheet, cash flow).

alter table public.registry_stocks
  add column if not exists balance_sheet jsonb default '{}'::jsonb,
  add column if not exists cash_flow jsonb default '{}'::jsonb;
