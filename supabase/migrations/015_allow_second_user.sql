-- Allow a second verified Google account through the RLS gate.
-- Keep this email list in sync with ALLOWED_GOOGLE_EMAILS and firestore.rules isOwner().
--
-- Personal rows stay isolated: user-scoped policies still require
-- user_id = public.firebase_user_id(), so each Google account only sees its own
-- trades, plans, watchlists, and uploads. Shared market tables (universe, quotes)
-- remain readable by every allowed user.

create or replace function public.is_allowed_user()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in (
    'ekirastogi@gmail.com',
    'shivisingh2996@gmail.com'
  )
    and coalesce((auth.jwt() -> 'email_verified')::boolean, false);
$$;
