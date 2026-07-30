<!-- Generated file. Read-only. Regenerate from rovno-db. -->
<!-- Secondary summary view. Structured JSON and mirrored SQL are authoritative over this markdown. -->

# Workspace Contract

Generated secondary summary view for a derived contract bundle.
Mirrored SQL and normalized JSON remain authoritative over this markdown.

## Source Migrations

- `supabase/migrations/20260306160500_core_profiles_and_preferences.sql`
- `supabase/migrations/20260306165500_auth_bootstrap_and_domain_rpc.sql`
- `supabase/migrations/20260306161000_projects_membership_and_invites.sql`
- `supabase/migrations/20260306161500_project_planning_tasks_and_comments.sql`
- `supabase/migrations/20260324140000_project_launch_authority.sql`
- `supabase/migrations/20260415100000_wave5_ai_chat_session_continuity.sql`
- `supabase/migrations/20260513140000_p0_derived_chat_key_for_ai_sessions.sql`
- `supabase/migrations/20260506120000_organizations_and_membership.sql`
- `supabase/migrations/20260506120400_accept_project_invite_with_org.sql`
- `supabase/migrations/20260725120000_invite_replay_guard.sql`
- `supabase/migrations/20260325100000_sensitive_visibility_and_document_classification.sql`
- `supabase/migrations/20260406184500_track1_hr_operational_summary_role_gate.sql`
- `supabase/migrations/20260505233155_fix_layer_a_stage_status_semantics.sql`
- `supabase/migrations/20260513150000_p0_chat_session_handlers_use_derived_key.sql`
- `supabase/migrations/20260415120000_wave6_participants_activity_ai_evidence_rpcs.sql`
- `supabase/migrations/20260514150000_p0_fix_uuid_v5_search_path_for_pgcrypto_digest.sql`
- `supabase/migrations/20260306170000_grants_rls_enablement_and_policies.sql`
- `supabase/migrations/20260313180000_projects_owner_only_rls_hotfix.sql`
- `supabase/migrations/20260320130000_codex_review_findings_fixes.sql`
- `supabase/migrations/20260325123000_restore_projects_select_membership_visibility.sql`
- `supabase/migrations/20260325133000_break_projects_project_members_rls_cycle.sql`
- `supabase/migrations/20260326190000_restore_co_owner_project_members_rls_subset.sql`

## Tables

### public.profiles

| Column | Type | Nullable | Default | Primary Key |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | no |   | yes |
| `email` | `text` | yes |   | no |
| `full_name` | `text` | yes |   | no |
| `avatar_url` | `text` | yes |   | no |
| `locale` | `text` | no | `'ru'` | no |
| `timezone` | `text` | no | `'UTC'` | no |
| `plan` | `text` | no | `'free'` | no |
| `credits_free` | `integer` | no | `0` | no |
| `credits_paid` | `integer` | no | `0` | no |
| `created_at` | `timestamptz` | no | `now()` | no |
| `updated_at` | `timestamptz` | no | `now()` | no |
| `onboarding_completed_at` | `timestamptz` | yes |   | no |
| `tutorials_completed` | `text[]` | no | `'{}'` | no |

Constraints:
- unnamed check (expression `locale in ('ru', 'en', 'de', 'fr')`)
- unnamed check (expression `plan in ('free', 'pro', 'business')`)
- unnamed check (expression `credits_free >= 0`)
- unnamed check (expression `credits_paid >= 0`)

Indexes:
- `idx_profiles_email_unique` on (`lower(email)`), unique, where `email is not null`

Triggers:
- `set_profiles_updated_at`: before update, executes `public.set_updated_at()`
- `on_profile_created_defaults`: after insert, executes `public.handle_profile_defaults()`

### public.profile_settings

| Column | Type | Nullable | Default | Primary Key |
| --- | --- | --- | --- | --- |
| `profile_id` | `uuid` | no |   | yes |
| `role_title` | `text` | yes |   | no |
| `phone` | `text` | yes |   | no |
| `bio` | `text` | yes |   | no |
| `signature_block` | `text` | yes |   | no |
| `currency` | `text` | no | `'RUB'` | no |
| `units` | `text` | no | `'metric'` | no |
| `date_format` | `text` | no | `'dd.MM.yyyy'` | no |
| `week_start` | `text` | no | `'monday'` | no |
| `ai_output_language` | `text` | no | `'auto'` | no |
| `automation_level` | `text` | no | `'assisted'` | no |
| `ai_data_usage_enabled` | `boolean` | no | `true` | no |
| `created_at` | `timestamptz` | no | `now()` | no |
| `updated_at` | `timestamptz` | no | `now()` | no |
| `active_org_id` | `uuid` | yes |   | no |

Constraints:
- unnamed check (expression `currency in ('RUB', 'USD', 'EUR', 'GBP')`)
- unnamed check (expression `units in ('metric', 'imperial')`)
- unnamed check (expression `date_format in ('dd.MM.yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd')`)
- unnamed check (expression `week_start in ('monday', 'sunday')`)
- unnamed check (expression `ai_output_language in ('ru', 'en', 'auto')`)
- unnamed check (expression `automation_level in ('manual', 'assisted', 'full', 'observer')`)

Triggers:
- `set_profile_settings_updated_at`: before update, executes `public.set_updated_at()`

### public.notification_preferences

| Column | Type | Nullable | Default | Primary Key |
| --- | --- | --- | --- | --- |
| `profile_id` | `uuid` | no |   | yes |
| `in_app_enabled` | `boolean` | no | `true` | no |
| `email_enabled` | `boolean` | no | `false` | no |
| `digest_frequency` | `text` | no | `'instant'` | no |
| `event_toggles` | `jsonb` | no | `'{}'::jsonb` | no |
| `created_at` | `timestamptz` | no | `now()` | no |
| `updated_at` | `timestamptz` | no | `now()` | no |

Constraints:
- unnamed check (expression `digest_frequency in ('instant', 'daily', 'weekly')`)

Triggers:
- `set_notification_preferences_updated_at`: before update, executes `public.set_updated_at()`

### public.projects

| Column | Type | Nullable | Default | Primary Key |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | no | `gen_random_uuid()` | yes |
| `owner_profile_id` | `uuid` | no |   | no |
| `title` | `text` | no |   | no |
| `project_type` | `text` | no |   | no |
| `project_mode` | `text` | no | `'contractor'` | no |
| `automation_level` | `text` | no | `'assisted'` | no |
| `current_stage_id` | `uuid` | yes |   | no |
| `progress_pct` | `integer` | no | `0` | no |
| `address` | `text` | yes |   | no |
| `ai_description` | `text` | yes |   | no |
| `archived_at` | `timestamptz` | yes |   | no |
| `created_at` | `timestamptz` | no | `now()` | no |
| `updated_at` | `timestamptz` | no | `now()` | no |

Constraints:
- unnamed check (expression `project_mode in ('build_myself', 'contractor')`)
- unnamed check (expression `automation_level in ('manual', 'assisted', 'full', 'observer')`)
- unnamed check (expression `progress_pct between 0 and 100`)
- `projects_current_stage_id_fkey` foreign_key (columns `current_stage_id`)

Indexes:
- `idx_projects_owner_profile_id` on (`owner_profile_id`)
- `idx_projects_archived_at` on (`archived_at`)

Triggers:
- `set_projects_updated_at`: before update, executes `public.set_updated_at()`
- `guard_projects_owner_profile_id`: before update, executes `public.guard_project_owner_change()`
- `on_project_owner_membership`: after insert or update of owner_profile_id, executes `public.handle_project_owner_membership()`

### public.project_members

| Column | Type | Nullable | Default | Primary Key |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | no | `gen_random_uuid()` | yes |
| `project_id` | `uuid` | no |   | no |
| `profile_id` | `uuid` | no |   | no |
| `role` | `text` | no |   | no |
| `ai_access` | `text` | no | `'none'` | no |
| `viewer_regime` | `text` | yes |   | no |
| `credit_limit` | `integer` | no | `0` | no |
| `used_credits` | `integer` | no | `0` | no |
| `joined_at` | `timestamptz` | no | `now()` | no |
| `finance_visibility` | `text` | no | `'none'` | no |
| `internal_docs_visibility` | `text` | no | `'none'` | no |

Constraints:
- unnamed check (expression `role in ('owner', 'co_owner', 'contractor', 'viewer')`)
- unnamed check (expression `ai_access in ('none', 'consult_only', 'project_pool')`)
- unnamed check (expression `viewer_regime in ('contractor', 'client', 'build_myself')`)
- unnamed check (expression `credit_limit >= 0`)
- unnamed check (expression `used_credits >= 0`)
- `project_members_viewer_role_regime_check` check (expression `(role = 'viewer' and viewer_regime is not null) or (role <> 'viewer' and viewer_regime is null)`)
- unnamed unique (columns `project_id`, `profile_id`)
- unnamed check (expression `finance_visibility in ('none', 'summary', 'detail')`)
- unnamed check (expression `internal_docs_visibility in ('none', 'view', 'edit')`)

Indexes:
- `idx_project_members_project_id` on (`project_id`)
- `idx_project_members_profile_id` on (`profile_id`)

Triggers:
- `guard_project_members_owner_role`: before insert or update, executes `public.enforce_project_member_owner_role()`
- `enforce_project_member_delegation`: before insert or update, executes `public.enforce_project_member_delegation()`

### public.project_invites

| Column | Type | Nullable | Default | Primary Key |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | no | `gen_random_uuid()` | yes |
| `project_id` | `uuid` | no |   | no |
| `email` | `text` | no |   | no |
| `role` | `text` | no |   | no |
| `ai_access` | `text` | no | `'none'` | no |
| `viewer_regime` | `text` | yes |   | no |
| `credit_limit` | `integer` | no | `0` | no |
| `invited_by` | `uuid` | no |   | no |
| `status` | `text` | no | `'pending'` | no |
| `invite_token` | `text` | no | `gen_random_uuid()::text` | no |
| `accepted_profile_id` | `uuid` | yes |   | no |
| `created_at` | `timestamptz` | no | `now()` | no |
| `accepted_at` | `timestamptz` | yes |   | no |
| `finance_visibility` | `text` | no | `'none'` | no |
| `internal_docs_visibility` | `text` | no | `'none'` | no |
| `add_to_org_id` | `uuid` | yes |   | no |
| `expires_at` | `timestamptz` | yes | `(now() + interval '14 days')` | no |

Constraints:
- unnamed check (expression `role in ('owner', 'co_owner', 'contractor', 'viewer')`)
- unnamed check (expression `ai_access in ('none', 'consult_only', 'project_pool')`)
- unnamed check (expression `viewer_regime in ('contractor', 'client', 'build_myself')`)
- unnamed check (expression `credit_limit >= 0`)
- unnamed check (expression `status in ('pending', 'accepted', 'revoked', 'expired')`)
- `project_invites_viewer_role_regime_check` check (expression `(role = 'viewer' and viewer_regime is not null) or (role <> 'viewer' and viewer_regime is null)`)
- unnamed unique (columns `invite_token`)
- unnamed check (expression `finance_visibility in ('none', 'summary', 'detail')`)
- unnamed check (expression `internal_docs_visibility in ('none', 'view', 'edit')`)

Indexes:
- `idx_project_invites_active_email` on (`project_id`, `lower(email)`), unique, where `status = 'pending'`
- `idx_project_invites_project_id` on (`project_id`)
- `idx_project_invites_invited_by` on (`invited_by`)

Triggers:
- `enforce_project_invite_delegation`: before insert or update, executes `public.enforce_project_invite_delegation()`

### public.project_ai_chat_sessions

| Column | Type | Nullable | Default | Primary Key |
| --- | --- | --- | --- | --- |
| `chat_id` | `uuid` | no |   | yes |
| `project_id` | `uuid` | no |   | no |
| `profile_id` | `uuid` | no |   | no |
| `recent_turns` | `jsonb` | no | `'[]'::jsonb` | no |
| `rolling_summary` | `text` | yes |   | no |
| `updated_at` | `timestamptz` | no | `now()` | no |
| `derived_chat_key` | `uuid` | no |   | no |

Constraints:
- `project_ai_chat_sessions_recent_turns_is_array` check (expression `jsonb_typeof(recent_turns) = 'array'`)

Indexes:
- `idx_project_ai_chat_sessions_project_profile` on (`project_id`, `profile_id`)
- `uq_project_ai_chat_sessions_derived_chat_key` on (`derived_chat_key`), unique

## Relations

| From | To | On Delete | Source |
| --- | --- | --- | --- |
| `public.profiles(id)` | `auth.users(id)` | `cascade` | `supabase/migrations/20260306160500_core_profiles_and_preferences.sql` |
| `public.profile_settings(profile_id)` | `public.profiles(id)` | `cascade` | `supabase/migrations/20260306160500_core_profiles_and_preferences.sql` |
| `public.notification_preferences(profile_id)` | `public.profiles(id)` | `cascade` | `supabase/migrations/20260306160500_core_profiles_and_preferences.sql` |
| `public.projects(owner_profile_id)` | `public.profiles(id)` | `restrict` | `supabase/migrations/20260306161000_projects_membership_and_invites.sql` |
| `public.project_members(project_id)` | `public.projects(id)` | `cascade` | `supabase/migrations/20260306161000_projects_membership_and_invites.sql` |
| `public.project_members(profile_id)` | `public.profiles(id)` | `cascade` | `supabase/migrations/20260306161000_projects_membership_and_invites.sql` |
| `public.project_invites(project_id)` | `public.projects(id)` | `cascade` | `supabase/migrations/20260306161000_projects_membership_and_invites.sql` |
| `public.project_invites(invited_by)` | `public.profiles(id)` | `restrict` | `supabase/migrations/20260306161000_projects_membership_and_invites.sql` |
| `public.project_invites(accepted_profile_id)` | `public.profiles(id)` | `set null` | `supabase/migrations/20260306161000_projects_membership_and_invites.sql` |
| `public.projects(current_stage_id)` | `public.project_stages(id)` | `set null` | `supabase/migrations/20260306161500_project_planning_tasks_and_comments.sql` |
| `public.project_ai_chat_sessions(project_id)` | `public.projects(id)` | `cascade` | `supabase/migrations/20260415100000_wave5_ai_chat_session_continuity.sql` |
| `public.project_ai_chat_sessions(profile_id)` | `public.profiles(id)` | `cascade` | `supabase/migrations/20260415100000_wave5_ai_chat_session_continuity.sql` |
| `public.profile_settings(active_org_id)` | `public.organizations(id)` | `set null` | `supabase/migrations/20260506120000_organizations_and_membership.sql` |
| `public.project_invites(add_to_org_id)` | `public.organizations(id)` | `set null` | `supabase/migrations/20260506120400_accept_project_invite_with_org.sql` |

## Functions

| Function | Returns | Auth Execute | Kind | Source |
| --- | --- | --- | --- | --- |
| `public.guard_project_owner_change()` | `trigger` | no | `trigger_helper` | `supabase/migrations/20260306161000_projects_membership_and_invites.sql` |
| `public.handle_project_owner_membership()` | `trigger` | no | `trigger_helper` | `supabase/migrations/20260324140000_project_launch_authority.sql` |
| `public.enforce_project_member_owner_role()` | `trigger` | no | `trigger_helper` | `supabase/migrations/20260306161000_projects_membership_and_invites.sql` |
| `public.handle_profile_defaults()` | `trigger` | no | `trigger_helper` | `supabase/migrations/20260306165500_auth_bootstrap_and_domain_rpc.sql` |
| `public.handle_auth_user_created()` | `trigger` | no | `trigger_helper` | `supabase/migrations/20260306165500_auth_bootstrap_and_domain_rpc.sql` |
| `public.current_profile_id()` | `uuid` | yes | `rpc` | `supabase/migrations/20260306165500_auth_bootstrap_and_domain_rpc.sql` |
| `public.project_role(uuid)` | `text` | yes | `rpc` | `supabase/migrations/20260306165500_auth_bootstrap_and_domain_rpc.sql` |
| `public.is_project_member(uuid)` | `boolean` | yes | `rpc` | `supabase/migrations/20260306165500_auth_bootstrap_and_domain_rpc.sql` |
| `public.has_project_role(uuid, text[])` | `boolean` | yes | `rpc` | `supabase/migrations/20260306165500_auth_bootstrap_and_domain_rpc.sql` |
| `public.can_access_project(uuid)` | `boolean` | yes | `rpc` | `supabase/migrations/20260306165500_auth_bootstrap_and_domain_rpc.sql` |
| `public.can_manage_project(uuid)` | `boolean` | yes | `rpc` | `supabase/migrations/20260306165500_auth_bootstrap_and_domain_rpc.sql` |
| `public.can_write_project_content(uuid)` | `boolean` | yes | `rpc` | `supabase/migrations/20260306165500_auth_bootstrap_and_domain_rpc.sql` |
| `public.can_see_profile(uuid)` | `boolean` | yes | `rpc` | `supabase/migrations/20260306165500_auth_bootstrap_and_domain_rpc.sql` |
| `public.accept_project_invite(text)` | `public.project_invites` | yes | `rpc` | `supabase/migrations/20260725120000_invite_replay_guard.sql` |
| `public.effective_finance_visibility(uuid)` | `text` | yes | `rpc` | `supabase/migrations/20260325100000_sensitive_visibility_and_document_classification.sql` |
| `public.effective_internal_docs_visibility(uuid)` | `text` | yes | `rpc` | `supabase/migrations/20260325100000_sensitive_visibility_and_document_classification.sql` |
| `public.effective_ai_access_for_profile(uuid)` | `text` | yes | `rpc` | `supabase/migrations/20260324140000_project_launch_authority.sql` |
| `public.can_view_internal_documents(uuid)` | `boolean` | yes | `rpc` | `supabase/migrations/20260325100000_sensitive_visibility_and_document_classification.sql` |
| `public.can_view_sensitive_detail(uuid)` | `boolean` | yes | `rpc` | `supabase/migrations/20260325100000_sensitive_visibility_and_document_classification.sql` |
| `public.can_access_hr_domain(uuid)` | `boolean` | yes | `rpc` | `supabase/migrations/20260406184500_track1_hr_operational_summary_role_gate.sql` |
| `public.get_ai_project_snapshot(uuid)` | `jsonb` | yes | `rpc` | `supabase/migrations/20260505233155_fix_layer_a_stage_status_semantics.sql` |
| `public.get_ai_chat_session_continuity(uuid, uuid)` | `jsonb` | yes | `rpc` | `supabase/migrations/20260513150000_p0_chat_session_handlers_use_derived_key.sql` |
| `public.append_ai_chat_session_turns(uuid, uuid, text, text)` | `void` | yes | `rpc` | `supabase/migrations/20260513150000_p0_chat_session_handlers_use_derived_key.sql` |
| `public.get_project_participants_ai_evidence(uuid, integer, integer)` | `jsonb` | yes | `rpc` | `supabase/migrations/20260415120000_wave6_participants_activity_ai_evidence_rpcs.sql` |
| `public.resolve_ai_chat_key(uuid, uuid)` | `uuid` | yes | `rpc` | `supabase/migrations/20260514150000_p0_fix_uuid_v5_search_path_for_pgcrypto_digest.sql` |

## RLS and Grants

### public.profiles

- RLS enabled: yes
- Authenticated grants: `insert`, `select`, `update`
- Policies:
  - `profiles_select` for `select` to `authenticated`
    using: `id = auth.uid() or exists ( select 1 from public.projects p where p.owner_profile_id = auth.uid() and ( p.owner_profile_id = profiles.id or exists ( select 1 from public.project_members pm_target where pm_target.project_id = p.id and pm_target.profile_id = profiles.id ) ) ) or exists ( select 1 from public.project_members pm_self join public.projects p on p.id = pm_self.project_id where pm_self.profile_id = auth.uid() and p.owner_profile_id = profiles.id )`
  - `profiles_insert` for `insert` to `authenticated`
    with check: `id = auth.uid()`
  - `profiles_update` for `update` to `authenticated`
    using: `id = auth.uid()`
    with check: `id = auth.uid()`

### public.profile_settings

- RLS enabled: yes
- Authenticated grants: `insert`, `select`, `update`
- Policies:
  - `profile_settings_select` for `select` to `authenticated`
    using: `profile_id = auth.uid()`
  - `profile_settings_insert` for `insert` to `authenticated`
    with check: `profile_id = auth.uid()`
  - `profile_settings_update` for `update` to `authenticated`
    using: `profile_id = auth.uid()`
    with check: `profile_id = auth.uid()`

### public.notification_preferences

- RLS enabled: yes
- Authenticated grants: `insert`, `select`, `update`
- Policies:
  - `notification_preferences_select` for `select` to `authenticated`
    using: `profile_id = auth.uid()`
  - `notification_preferences_insert` for `insert` to `authenticated`
    with check: `profile_id = auth.uid()`
  - `notification_preferences_update` for `update` to `authenticated`
    using: `profile_id = auth.uid()`
    with check: `profile_id = auth.uid()`

### public.projects

- RLS enabled: yes
- Authenticated grants: `delete`, `insert`, `select`, `update`
- Policies:
  - `projects_insert` for `insert` to `authenticated`
    with check: `owner_profile_id = auth.uid()`
  - `projects_delete` for `delete` to `authenticated`
    using: `owner_profile_id = auth.uid()`
  - `projects_update` for `update` to `authenticated`
    using: `owner_profile_id = auth.uid()`
    with check: `owner_profile_id = auth.uid() or exists ( select 1 from public.project_members pm where pm.project_id = id and pm.profile_id = owner_profile_id and pm.role in ('owner', 'co_owner') )`
  - `projects_select` for `select` to `authenticated`
    using: `owner_profile_id = auth.uid() or exists ( select 1 from public.project_members pm where pm.project_id = id and pm.profile_id = auth.uid() )`

### public.project_members

- RLS enabled: yes
- Authenticated grants: `delete`, `insert`, `select`, `update`
- Policies:
  - `project_members_insert` for `insert` to `authenticated`
    with check: `public.is_project_owner_for_actor(project_id, auth.uid()) and ( role <> 'owner' or profile_id = ( select p.owner_profile_id from public.projects p where p.id = project_id ) )`
  - `project_members_delete` for `delete` to `authenticated`
    using: `public.is_project_owner_for_actor(project_id, auth.uid()) and profile_id <> ( select p.owner_profile_id from public.projects p where p.id = project_id )`
  - `project_members_select` for `select` to `authenticated`
    using: `profile_id = auth.uid() or public.is_project_owner_for_actor(project_id, auth.uid()) or public.project_role_for_profile(project_id, auth.uid()) = 'co_owner'`
  - `project_members_update` for `update` to `authenticated`
    using: `( public.is_project_owner_for_actor(project_id, auth.uid()) and profile_id <> ( select p.owner_profile_id from public.projects p where p.id = project_id ) ) or ( public.project_role_for_profile(project_id, auth.uid()) = 'co_owner' and role in ('contractor', 'viewer') and profile_id <> ( select p.owner_profile_id from public.projects p where p.id = project_id ) )`
    with check: `( public.is_project_owner_for_actor(project_id, auth.uid()) and profile_id <> ( select p.owner_profile_id from public.projects p where p.id = project_id ) ) or ( public.project_role_for_profile(project_id, auth.uid()) = 'co_owner' and role in ('contractor', 'viewer') and profile_id <> ( select p.owner_profile_id from public.projects p where p.id = project_id ) )`

### public.project_invites

- RLS enabled: yes
- Authenticated grants: `delete`, `insert`, `select`, `update`
- Policies:
  - `project_invites_select` for `select` to `authenticated`
    using: `public.can_manage_project(project_id)`
  - `project_invites_insert` for `insert` to `authenticated`
    with check: `public.can_manage_project(project_id) and invited_by = auth.uid()`
  - `project_invites_update` for `update` to `authenticated`
    using: `public.can_manage_project(project_id)`
    with check: `public.can_manage_project(project_id)`
  - `project_invites_delete` for `delete` to `authenticated`
    using: `public.can_manage_project(project_id)`

### public.project_ai_chat_sessions

- RLS enabled: yes
- Authenticated grants: none
- Policies: none

