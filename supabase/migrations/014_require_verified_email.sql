-- Require a verified email in the RLS gate.
--
-- Every row-level policy in this schema funnels through is_allowed_user(), so this function is
-- the entire Supabase perimeter. It previously trusted the JWT `email` claim alone, while
-- firestore.rules already required `email_verified == true` (see isOwner()). That gap matters
-- because the Firebase Web API key is public by design: anyone can call the Identity Toolkit
-- signUp endpoint directly, and if password sign-in is enabled with multiple accounts allowed
-- per address, a self-registered account carrying this email would arrive with
-- email_verified:false and still satisfy the check — granting full read and write on the whole
-- trading history, since the user policies are declared `for all`.
--
-- Closing it here brings Supabase in line with Firestore.
create or replace function public.is_allowed_user()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'ekirastogi@gmail.com'
    and coalesce((auth.jwt() -> 'email_verified')::boolean, false);
$$;
