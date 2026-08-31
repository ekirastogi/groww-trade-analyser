-- Worker approval poll: approval_status='approved' AND status='pending_approval'
create index if not exists idx_recommendations_approval_poll
  on public.recommendations (approval_status, status)
  where approval_status = 'approved' and status = 'pending_approval';
