<!-- Generated file. Read-only. Regenerate from rovno-db. -->
<!-- Secondary summary view. Structured JSON and mirrored SQL are authoritative over this markdown. -->

# Activity Billing Contract

Generated secondary summary view for a derived contract bundle.
Mirrored SQL and normalized JSON remain authoritative over this markdown.

## Source Migrations

- `supabase/migrations/20260306164500_activity_and_notifications.sql`
- `supabase/migrations/20260306165000_billing_launch_tables.sql`
- `supabase/migrations/20260415120000_wave6_participants_activity_ai_evidence_rpcs.sql`
- `supabase/migrations/20260306170000_grants_rls_enablement_and_policies.sql`

## Tables

### public.activity_events

| Column | Type | Nullable | Default | Primary Key |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | no | `gen_random_uuid()` | yes |
| `project_id` | `uuid` | no |   | no |
| `actor_profile_id` | `uuid` | yes |   | no |
| `entity_type` | `text` | no |   | no |
| `entity_id` | `uuid` | yes |   | no |
| `action_type` | `text` | no |   | no |
| `payload` | `jsonb` | no | `'{}'::jsonb` | no |
| `created_at` | `timestamptz` | no | `now()` | no |

Indexes:
- `idx_activity_events_project_id` on (`project_id`)
- `idx_activity_events_actor_profile_id` on (`actor_profile_id`)
- `idx_activity_events_project_created_at` on (`project_id`, `created_at desc`)

### public.notifications

| Column | Type | Nullable | Default | Primary Key |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | no | `gen_random_uuid()` | yes |
| `profile_id` | `uuid` | no |   | no |
| `project_id` | `uuid` | yes |   | no |
| `type` | `text` | no |   | no |
| `title` | `text` | no |   | no |
| `body` | `text` | yes |   | no |
| `is_read` | `boolean` | no | `false` | no |
| `payload` | `jsonb` | no | `'{}'::jsonb` | no |
| `created_at` | `timestamptz` | no | `now()` | no |
| `read_at` | `timestamptz` | yes |   | no |

Indexes:
- `idx_notifications_profile_id` on (`profile_id`)
- `idx_notifications_project_id` on (`project_id`)
- `idx_notifications_profile_is_read_created_at` on (`profile_id`, `is_read`, `created_at desc`)

### public.billing_customers

| Column | Type | Nullable | Default | Primary Key |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | no | `gen_random_uuid()` | yes |
| `profile_id` | `uuid` | no |   | no |
| `provider` | `text` | no |   | no |
| `external_customer_id` | `text` | no |   | no |
| `email` | `text` | yes |   | no |
| `full_name` | `text` | yes |   | no |
| `created_at` | `timestamptz` | no | `now()` | no |
| `updated_at` | `timestamptz` | no | `now()` | no |

Constraints:
- unnamed unique (columns `provider`, `external_customer_id`)
- unnamed unique (columns `profile_id`, `provider`)
- `billing_customers_provider_check` check (expression `provider in ('stripe', 'tbank')`)

Indexes:
- `idx_billing_customers_profile_id` on (`profile_id`)

Triggers:
- `set_billing_customers_updated_at`: before update, executes `public.set_updated_at()`

### public.subscriptions

| Column | Type | Nullable | Default | Primary Key |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | no | `gen_random_uuid()` | yes |
| `profile_id` | `uuid` | no |   | no |
| `billing_customer_id` | `uuid` | no |   | no |
| `provider` | `text` | no |   | no |
| `external_subscription_id` | `text` | no |   | no |
| `plan_code` | `text` | no |   | no |
| `status` | `text` | no |   | no |
| `is_current` | `boolean` | no | `false` | no |
| `currency` | `text` | no | `'RUB'` | no |
| `amount_cents` | `bigint` | yes |   | no |
| `trial_starts_at` | `timestamptz` | yes |   | no |
| `trial_ends_at` | `timestamptz` | yes |   | no |
| `current_period_starts_at` | `timestamptz` | yes |   | no |
| `current_period_ends_at` | `timestamptz` | yes |   | no |
| `canceled_at` | `timestamptz` | yes |   | no |
| `provider_synced_at` | `timestamptz` | yes |   | no |
| `created_at` | `timestamptz` | no | `now()` | no |
| `updated_at` | `timestamptz` | no | `now()` | no |
| `auto_renew` | `boolean` | no | `false` | no |
| `rebill_id` | `text` | yes |   | no |
| `grace_until` | `timestamptz` | yes |   | no |

Constraints:
- unnamed check (expression `status in ('trialing', 'active', 'past_due', 'paused', 'canceled', 'incomplete', 'incomplete_expired')`)
- unnamed check (expression `currency in ('RUB', 'USD', 'EUR', 'GBP')`)
- unnamed check (expression `amount_cents is null or amount_cents >= 0`)
- unnamed unique (columns `provider`, `external_subscription_id`)
- `subscriptions_provider_check` check (expression `provider in ('stripe', 'tbank')`)

Indexes:
- `idx_subscriptions_profile_id` on (`profile_id`)
- `idx_subscriptions_billing_customer_id` on (`billing_customer_id`)
- `idx_subscriptions_current_per_profile` on (`profile_id`), unique, where `is_current = true`
- `idx_subscriptions_rebill_id` on (`rebill_id`), where `rebill_id is not null`
- `idx_subscriptions_grace_until` on (`grace_until`), where `grace_until is not null`

Triggers:
- `set_subscriptions_updated_at`: before update, executes `public.set_updated_at()`

## Relations

| From | To | On Delete | Source |
| --- | --- | --- | --- |
| `public.activity_events(project_id)` | `public.projects(id)` | `cascade` | `supabase/migrations/20260306164500_activity_and_notifications.sql` |
| `public.activity_events(actor_profile_id)` | `public.profiles(id)` | `set null` | `supabase/migrations/20260306164500_activity_and_notifications.sql` |
| `public.notifications(profile_id)` | `public.profiles(id)` | `cascade` | `supabase/migrations/20260306164500_activity_and_notifications.sql` |
| `public.notifications(project_id)` | `public.projects(id)` | `cascade` | `supabase/migrations/20260306164500_activity_and_notifications.sql` |
| `public.billing_customers(profile_id)` | `public.profiles(id)` | `cascade` | `supabase/migrations/20260306165000_billing_launch_tables.sql` |
| `public.subscriptions(profile_id)` | `public.profiles(id)` | `cascade` | `supabase/migrations/20260306165000_billing_launch_tables.sql` |
| `public.subscriptions(billing_customer_id)` | `public.billing_customers(id)` | `cascade` | `supabase/migrations/20260306165000_billing_launch_tables.sql` |

## Functions

| Function | Returns | Auth Execute | Kind | Source |
| --- | --- | --- | --- | --- |
| `public.get_activity_ai_evidence(uuid, integer, integer)` | `jsonb` | yes | `rpc` | `supabase/migrations/20260415120000_wave6_participants_activity_ai_evidence_rpcs.sql` |

## RLS and Grants

### public.activity_events

- RLS enabled: yes
- Authenticated grants: `insert`, `select`
- Policies:
  - `activity_events_select` for `select` to `authenticated`
    using: `public.can_access_project(project_id)`
  - `activity_events_insert` for `insert` to `authenticated`
    with check: `public.can_write_project_content(project_id) and (actor_profile_id is null or actor_profile_id = auth.uid())`

### public.notifications

- RLS enabled: yes
- Authenticated grants: `select`, `update`
- Policies:
  - `notifications_select` for `select` to `authenticated`
    using: `profile_id = auth.uid()`
  - `notifications_update` for `update` to `authenticated`
    using: `profile_id = auth.uid()`
    with check: `profile_id = auth.uid()`

### public.billing_customers

- RLS enabled: yes
- Authenticated grants: `select`
- Policies:
  - `billing_customers_select` for `select` to `authenticated`
    using: `profile_id = auth.uid()`

### public.subscriptions

- RLS enabled: yes
- Authenticated grants: `select`
- Policies:
  - `subscriptions_select` for `select` to `authenticated`
    using: `profile_id = auth.uid()`

