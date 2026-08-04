<!-- Generated file. Read-only. Regenerate from rovno-db. -->
<!-- Summary view. The migrations under supabase/migrations/ are authoritative. -->

DO NOT EDIT.

Generated from rovno-db/scripts/generate-backend-truth.mjs

# Backend Truth

This directory is fully generated from a curated subset of `rovno-db` migrations.
It is an allowlist-specific extractor for the source migrations below, not a generic SQL migration parser.

## Read-Only

- Do not edit files in this directory by hand.
- Regenerate from `rovno-db` using `node scripts/generate-backend-truth.mjs`.
- The mirror is deterministic and should be fully replaced on sync.
- Unsupported or unexpected SQL in the curated allowlist causes generation to fail instead of writing partial output.

## What This Is, And What It Is Not

- `generated/supabase-types.ts` is the one load-bearing artifact: it is imported by
  `rovno/src`, so schema drift fails `npm run typecheck` instead of reaching a user.
- It is generated from the CURATED allowlist below, so it is deliberately partial.
  A table or RPC in an excluded migration is absent here and typed nowhere.
- The migrations under `rovno-db/supabase/migrations/` are the only complete picture.
  An object's real definition is every migration touching its name, in timestamp order.
- Structured JSON contract views, per-slice bundles, markdown contracts and a mirrored
  SQL copy used to live here too. They were removed in rovno-db#106: nothing read them,
  and being silently two-thirds complete made them actively misleading for the RLS and
  permission questions where being wrong costs the most.

## Source Migrations

- `supabase/migrations/20260306160000_extensions_and_base_helpers.sql`
- `supabase/migrations/20260306160500_core_profiles_and_preferences.sql`
- `supabase/migrations/20260306161000_projects_membership_and_invites.sql`
- `supabase/migrations/20260306161500_project_planning_tasks_and_comments.sql`
- `supabase/migrations/20260306162000_storage_documents_and_media.sql`
- `supabase/migrations/20260306162500_estimates_core.sql`
- `supabase/migrations/20260306163000_inventory_foundation.sql`
- `supabase/migrations/20260306163500_procurement_orders_and_inventory_movements.sql`
- `supabase/migrations/20260306164000_hr_domain.sql`
- `supabase/migrations/20260306164500_activity_and_notifications.sql`
- `supabase/migrations/20260306165000_billing_launch_tables.sql`
- `supabase/migrations/20260306165500_auth_bootstrap_and_domain_rpc.sql`
- `supabase/migrations/20260306170000_grants_rls_enablement_and_policies.sql`
- `supabase/migrations/20260313180000_projects_owner_only_rls_hotfix.sql`
- `supabase/migrations/20260313183000_tasks_estimate_work_lineage.sql`
- `supabase/migrations/20260317120000_storage_upload_intents.sql`
- `supabase/migrations/20260317121000_storage_upload_rpcs.sql`
- `supabase/migrations/20260317122000_storage_upload_grants_rls.sql`
- `supabase/migrations/20260317130000_storage_bucket_settings_split.sql`
- `supabase/migrations/20260317133000_storage_bucket_config_table.sql`
- `supabase/migrations/20260320110000_task_final_media_contract.sql`
- `supabase/migrations/20260320130000_codex_review_findings_fixes.sql`
- `supabase/migrations/20260320143000_add_sanitize_uploaded_filename.sql`
- `supabase/migrations/20260323110000_storage_project_media_insert_policy.sql`
- `supabase/migrations/20260323113000_finalize_media_bucket_ambiguity_fix.sql`
- `supabase/migrations/20260324140000_project_launch_authority.sql`
- `supabase/migrations/20260325100000_sensitive_visibility_and_document_classification.sql`
- `supabase/migrations/20260325120000_doc_media_visibility_write_enforcement.sql`
- `supabase/migrations/20260325123000_restore_projects_select_membership_visibility.sql`
- `supabase/migrations/20260325126000_fix_project_members_co_owner_policy_recursion.sql`
- `supabase/migrations/20260325130000_remove_co_owner_project_members_policy_branch.sql`
- `supabase/migrations/20260325133000_break_projects_project_members_rls_cycle.sql`
- `supabase/migrations/20260326190000_restore_co_owner_project_members_rls_subset.sql`
- `supabase/migrations/20260326203000_owner_transfer_and_member_identity_guard.sql`
- `supabase/migrations/20260326213000_internal_visibility_write_boundary.sql`
- `supabase/migrations/20260330160000_wave2_hr_lineage_and_projection_uniqueness.sql`
- `supabase/migrations/20260403103000_phase6_operational_summary_read_rpcs.sql`
- `supabase/migrations/20260403191500_phase6_operational_summary_subcontractor_and_client_amounts.sql`
- `supabase/migrations/20260405120000_resource_type_operational_visibility_and_hr_rpc.sql`
- `supabase/migrations/20260406183000_procurement_operational_summary_requested_and_ordered_line_types.sql`
- `supabase/migrations/20260406184500_track1_hr_operational_summary_role_gate.sql`
- `supabase/migrations/20260406200000_track1_estimate_operational_summary_finance_visibility.sql`
- `supabase/migrations/20260407190000_track4_upload_visibility_class.sql`
- `supabase/migrations/20260408100000_document_versions_insert_internal_visibility_parity.sql`
- `supabase/migrations/20260408120000_estimate_line_pricing_params.sql`
- `supabase/migrations/20260409120000_hr_select_policies_align_can_access_hr_domain.sql`
- `supabase/migrations/20260409140000_hr_write_policies_align_can_access_hr_domain.sql`
- `supabase/migrations/20260414120000_wave1_get_ai_project_snapshot.sql`
- `supabase/migrations/20260414140000_wave3_procurement_ai_operational_evidence_rpc.sql`
- `supabase/migrations/20260414150000_wave4_tasks_ai_operational_evidence_rpc.sql`
- `supabase/migrations/20260415100000_wave5_ai_chat_session_continuity.sql`
- `supabase/migrations/20260415120000_wave6_participants_activity_ai_evidence_rpcs.sql`
- `supabase/migrations/20260415130000_wave7_documents_media_ai_metadata_evidence.sql`
- `supabase/migrations/20260416100000_wave9_closeout_hardening.sql`
- `supabase/migrations/20260416120000_session2_ai_humanize_tasks_hr.sql`
- `supabase/migrations/20260416140000_session21_estimate_assignee_display_name.sql`
- `supabase/migrations/20260417120000_estimate_resource_line_assignee_profile.sql`
- `supabase/migrations/20260418120000_estimate_resource_line_assignee_label.sql`
- `supabase/migrations/20260419120000_session3c_procurement_ai_in_stock_evidence.sql`
- `supabase/migrations/20260425092624_profile_tutorial_state.sql`
- `supabase/migrations/20260428120000_resource_types_alignment.sql`
- `supabase/migrations/20260502120000_estimate_planned_dates_and_lag.sql`
- `supabase/migrations/20260504013553_layer_a_snapshot_enrichment.sql`
- `supabase/migrations/20260505233155_fix_layer_a_stage_status_semantics.sql`
- `supabase/migrations/20260506120000_organizations_and_membership.sql`
- `supabase/migrations/20260506120100_org_rls_helpers_and_policies.sql`
- `supabase/migrations/20260506120200_org_documents_and_doc_links.sql`
- `supabase/migrations/20260506120300_org_rpcs.sql`
- `supabase/migrations/20260506120400_accept_project_invite_with_org.sql`
- `supabase/migrations/20260506130000_fix_org_owner_membership_order.sql`
- `supabase/migrations/20260506140000_fix_org_delete_cascade_through_last_owner_guard.sql`
- `supabase/migrations/20260506150000_fix_org_rls_recursion.sql`
- `supabase/migrations/20260506160000_import_documents_creates_versions.sql`
- `supabase/migrations/20260507120000_rebuild_org_insert_delete_policies.sql`
- `supabase/migrations/20260507130000_debug_org_rls_state.sql`
- `supabase/migrations/20260507140000_debug_org_insert_rpc.sql`
- `supabase/migrations/20260507150000_drop_org_debug_rpcs.sql`
- `supabase/migrations/20260507160000_org_policy_resilience.sql`
- `supabase/migrations/20260508120000_fix_orgs_select_policy_returning_and_guc_name.sql`
- `supabase/migrations/20260509082719_fix_inventory_balances_trigger_on_project_cascade.sql`
- `supabase/migrations/20260509120000_import_documents_to_project_visibility.sql`
- `supabase/migrations/20260509130000_workspace_org_doc_uploads_and_orphan_safe_links.sql`
- `supabase/migrations/20260509140000_addresses_pr71_codex_findings.sql`
- `supabase/migrations/20260511120000_system_resource_articles_and_unit_conversions.sql`
- `supabase/migrations/20260511120100_seed_unit_conversions.sql`
- `supabase/migrations/20260512132310_estimate_templates_schema.sql`
- `supabase/migrations/20260512132320_template_rls.sql`
- `supabase/migrations/20260512132330_contractor_profiles_schema.sql`
- `supabase/migrations/20260512132340_template_rpcs.sql`
- `supabase/migrations/20260512140000_template_check_constraints_and_apply_rpc_hardening.sql`
- `supabase/migrations/20260513110100_estimate_share_snapshots_and_rpcs.sql`
- `supabase/migrations/20260513120000_harden_share_rpcs_codex_followup.sql`
- `supabase/migrations/20260513140000_p0_derived_chat_key_for_ai_sessions.sql`
- `supabase/migrations/20260513150000_p0_chat_session_handlers_use_derived_key.sql`
- `supabase/migrations/20260514120000_org_document_folders.sql`
- `supabase/migrations/20260514150000_p0_fix_uuid_v5_search_path_for_pgcrypto_digest.sql`
- `supabase/migrations/20260516120000_extend_billing_provider_to_tbank.sql`
- `supabase/migrations/20260516120100_create_payment_intents.sql`
- `supabase/migrations/20260516120200_alter_subscriptions_recurrent.sql`
- `supabase/migrations/20260521140100_create_org_with_contractor_profile.sql`
- `supabase/migrations/20260521140200_upsert_contractor_profile_preserve_fields.sql`
- `supabase/migrations/20260602075944_can_access_storage_object_workspace_org.sql`
- `supabase/migrations/20260602150000_canonical_library_stages_and_works.sql`
- `supabase/migrations/20260602150100_instance_tables_library_fks.sql`
- `supabase/migrations/20260602150200_apply_template_propagate_library_fks.sql`
- `supabase/migrations/20260604120000_create_card_bindings.sql`
- `supabase/migrations/20260604120100_get_card_on_file_prefer_binding.sql`
- `supabase/migrations/20260605130000_payment_intents_consent.sql`
- `supabase/migrations/20260611120000_project_estimates_execution_status.sql`
- `supabase/migrations/20260611120100_get_portfolio_finance_snapshot.sql`
- `supabase/migrations/20260613120000_enable_pg_trgm_and_article_name_search_indexes.sql`
- `supabase/migrations/20260613120100_search_canonical_library.sql`
- `supabase/migrations/20260613120200_list_canonical_stages_with_works.sql`
- `supabase/migrations/20260613120300_get_resource_article_detail.sql`
- `supabase/migrations/20260613120400_add_library_work_to_estimate.sql`
- `supabase/migrations/20260613120500_browse_canonical_catalog.sql`
- `supabase/migrations/20260613120600_get_resource_article_price_comparison.sql`
- `supabase/migrations/20260622120000_tighten_price_comparison_finance_gate.sql`
- `supabase/migrations/20260624120000_add_library_work_resource_exclusions.sql`
- `supabase/migrations/20260629120000_add_procurement_item_detail_columns.sql`
- `supabase/migrations/20260630110000_inventory_canonical_identity.sql`
- `supabase/migrations/20260630120000_cross_project_stock_transfer.sql`
- `supabase/migrations/20260630130000_cross_project_transfer_procurement_item_on_destination.sql`
- `supabase/migrations/20260630140000_cross_project_transfer_deferred_receipt.sql`
- `supabase/migrations/20260705191000_p31_procurement_received_columns.sql`
- `supabase/migrations/20260706120000_blog_schema.sql`
- `supabase/migrations/20260706140000_user_catalogs.sql`
- `supabase/migrations/20260712130000_estimate_projection_infra.sql`
- `supabase/migrations/20260712130200_sync_estimate_projection_rpc.sql`
- `supabase/migrations/20260713110100_project_sync_events_sensitivity_policy.sql`
- `supabase/migrations/20260713150000_change_task_status_v2.sql`
- `supabase/migrations/20260716205000_payment_intents_operation_identity_key.sql`
- `supabase/migrations/20260720120000_payment_intents_order_attempt.sql`
- `supabase/migrations/20260725120000_invite_replay_guard.sql`
- `supabase/migrations/20260725190000_profiles_locale_default_ru.sql`
- `supabase/migrations/20260726120000_drop_debug_org_rls_state2.sql`
- `supabase/migrations/20260727120000_drop_out_of_band_debug_rpcs.sql`
- `supabase/migrations/20260729130000_project_invites_expires_at.sql`

## Exclusions

- Draft or imported reset schema files
- Seeds, runtime config, Docker, deployment, and VPS files
- The rest of the `supabase/` tree outside the curated migration allowlist

## External Schema References

- Table `auth.users` referenced from `supabase/migrations/20260306160500_core_profiles_and_preferences.sql`
- Table `storage.objects` referenced from `supabase/migrations/20260323110000_storage_project_media_insert_policy.sql`

## Platform Dependencies

- Extension `pgcrypto` from `supabase/migrations/20260306160000_extensions_and_base_helpers.sql`
- Extension `pg_trgm` from `supabase/migrations/20260613120000_enable_pg_trgm_and_article_name_search_indexes.sql`

