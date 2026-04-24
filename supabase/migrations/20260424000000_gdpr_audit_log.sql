-- GDPR Audit Log
-- Tracks all GDPR webhook events received from Shopify for compliance.
-- Retained indefinitely as a legal audit trail; PII fields are scrubbed
-- after the redact event is processed.

create table if not exists gdpr_audit_log (
  id                   uuid primary key default gen_random_uuid(),
  event_type           text not null,           -- 'customers/data_request' | 'customers/redact' | 'shop/redact'
  shop_domain          text not null,
  client_id            uuid references auth.users(id) on delete set null,
  shopify_customer_id  text,
  customer_email       text,
  orders_requested     jsonb default '[]',
  payload_summary      jsonb default '{}',
  data_summary         jsonb default '{}',
  completed_at         timestamptz,
  created_at           timestamptz not null default now()
);

-- Index for fast lookups by shop and event type (used during redact completion updates)
create index if not exists gdpr_audit_log_shop_event_idx
  on gdpr_audit_log (shop_domain, event_type, created_at desc);

-- Index for customer-level lookups
create index if not exists gdpr_audit_log_email_idx
  on gdpr_audit_log (customer_email)
  where customer_email is not null;

-- RLS: only the service role can read/write this table (never expose to anon/client)
alter table gdpr_audit_log enable row level security;

-- No public policies — service role bypasses RLS by default in Supabase
-- Operators access this via the Supabase dashboard or admin tooling only
comment on table gdpr_audit_log is
  'GDPR compliance audit trail. Tracks data_request, customer redact, and shop redact events. '
  'Never expose via public API. Service-role access only.';
