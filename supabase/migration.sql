-- ============================================================
-- PMI Outreach CRM — Phase 1 schema
-- Run in the Supabase SQL editor (project zhvfcipveeeybczzmues).
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- Campaigns ----------
create table if not exists campaigns (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  brand             text not null,
  front_channel_address text not null,      -- also the sender address
  audience_type     text not null default 'retailers', -- 'print_shops' | 'retailers'
  product_info      text default '',          -- fed to Claude for follow-ups
  style_guide       text default '',          -- per-campaign tone instructions
  first_email_mode  text not null default 'immediate', -- 'immediate' | 'weeks'
  first_email_weeks int not null default 0,
  followup_weeks    int[] not null default '{}', -- weeks AFTER the previous email
  max_emails        int not null default 12,
  samples_enabled   boolean not null default false,
  dialogue_style_guide   text default 'Reply helpfully and personally to what the contact wrote. Answer their questions directly, keep it warm and concise, move the conversation forward, and sign off "Thank you very much,".',
  dialogue_followup_weeks int[] not null default '{2,4,8}', -- nudge-draft cadence
  dialogue_max_drafts    int not null default 4,    -- hard cap on dialogue drafts
  immediate_draft_response boolean not null default true, -- draft instantly on reply
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

-- ---------- Companies ----------
create table if not exists companies (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (campaign_id, name)
);

-- ---------- Leads ----------
create table if not exists leads (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references campaigns(id) on delete cascade,
  company_id        uuid references companies(id) on delete set null,
  first_name        text not null default '',
  last_name         text not null default '',
  email             text not null,
  status            text not null default 'cold', -- cold | dialogue | current_customer | inactive
  notes             text default '',
  samples           text[] not null default '{}', -- PMI only
  sequence_step     int not null default 0,       -- count of cold emails already sent
  dialogue_step     int not null default 0,       -- count of dialogue drafts created
  interval_overrides jsonb,                        -- per-lead interval edits
  front_conversation_id text,
  paused            boolean not null default false,
  source            text default 'manual',        -- manual | apollo | spreadsheet | zoho
  created_at        timestamptz not null default now()
);
-- Email is globally unique across the whole system (case-insensitive).
create unique index if not exists leads_email_global_unique on leads (lower(email));
create index if not exists leads_campaign_idx on leads (campaign_id);
create index if not exists leads_company_idx on leads (company_id);
create index if not exists leads_status_idx on leads (status);

-- ---------- Templates (seed Email 1 per campaign) ----------
create table if not exists templates (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  step        int not null default 1,
  subject     text not null default '',
  body        text not null default '',
  is_seed     boolean not null default true,
  unique (campaign_id, step)
);

-- ---------- Scheduled actions (the queue) ----------
create table if not exists scheduled_actions (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references leads(id) on delete cascade,
  campaign_id   uuid not null references campaigns(id) on delete cascade,
  action_type   text not null,            -- send | draft | comment
  step          int not null default 1,
  scheduled_for timestamptz not null,
  status        text not null default 'pending', -- pending | processing | done | canceled
  subject       text default '',
  generated_body text default '',
  channel_address text,
  group_recipients jsonb,
  is_override   boolean not null default false,
  error         text,
  created_at    timestamptz not null default now(),
  executed_at   timestamptz
);
create index if not exists sa_due_idx on scheduled_actions (status, scheduled_for);
create index if not exists sa_lead_idx on scheduled_actions (lead_id);
create index if not exists sa_channel_idx on scheduled_actions (channel_address, status, scheduled_for);

-- ---------- Sent log (idempotency + audit) ----------
create table if not exists sent_log (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid references leads(id) on delete set null,
  action_id     uuid unique,              -- one log row per action = no double send
  action_type   text,
  executed_at   timestamptz not null default now(),
  front_message_id text,
  front_conversation_id text
);

-- ---------- Saved searches (always-on prospecting) ----------
create table if not exists saved_searches (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid references campaigns(id) on delete cascade,
  name         text not null,
  apollo_params jsonb not null,
  last_run_at  timestamptz,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ---------- Prospect dedupe (credit-free) ----------
create table if not exists prospect_seen (
  id               uuid primary key default gen_random_uuid(),
  saved_search_id  uuid references saved_searches(id) on delete cascade,
  apollo_person_id text not null,
  name             text,
  company          text,
  title            text,
  state            text not null default 'suggested', -- suggested | imported | dismissed
  created_at       timestamptz not null default now(),
  unique (apollo_person_id)
);

-- ---------- Suppression list (Do Not Contact + hard bounces) ----------
create table if not exists suppression_list (
  email      text primary key,   -- store lowercased
  reason     text,
  created_at timestamptz not null default now()
);

-- ---------- Zoho Form sample mapping ----------
create table if not exists zoho_sample_map (
  id               uuid primary key default gen_random_uuid(),
  form_field_value text not null unique,
  sample_option    text not null
);

-- ---------- Settings (global) ----------
create table if not exists settings (
  key   text primary key,
  value text
);

-- ============================================================
-- Seed data
-- ============================================================

insert into settings (key, value) values
  ('global_style_corrections',
   'Sign off as Andrew. Keep emails short, warm, and human — no corporate filler. Never invent facts about the customer.'),
  ('send_window_start_hour', '8'),
  ('send_window_end_hour', '16'),
  ('stagger_seconds_min', '60'),
  ('stagger_seconds_max', '120'),
  ('business_days_only', 'true')
on conflict (key) do nothing;

-- Campaigns
insert into campaigns
  (name, brand, front_channel_address, audience_type, product_info, style_guide,
   first_email_mode, first_email_weeks, followup_weeks, max_emails, samples_enabled)
values
  ('PMI to Print Shops', 'PMI', 'andrew@pmitape.com', 'print_shops',
   'PMI manufactures industrial adhesive tapes for print/sign shops: Split Tape, Full Adhesive Tape, Quick Rip Tape, RED Tape, PalletGel, and Dual-Tack Pallet Tape.',
   'Match the tone of the initial email: short, warm, and personal. Ask how the requested samples worked out for them, offer to help if useful, and sign off with "Thank you very much,". Never pushy or salesy. Two or three sentences at most.',
   'weeks', 3, '{4,8,12}', 4, true),

  ('FloorBond to Retailers', 'FloorBond', 'andrew@floorbondtape.com', 'retailers',
   'FloorBond is a permanent flooring tape — the first flooring tape stronger than glue. Product info: https://www.floorbondtape.com/about-us. Proven incremental and accretive to flooring category sales at retail. Launch needs only 5" of shelf (case pack = one facing).',
   'Pitch to retail buyers. Confident but not salesy. Each follow-up should add a slightly new angle, never just repeat.',
   'immediate', 0, '{4,6,8,12,16,20,24,28,32,36,40}', 12, false),

  ('Tape Genie to Retailers', 'Tape Genie', 'andrew@tapegenie.com', 'retailers',
   'Tape Genie is a patent-pending rug tape that solves residue-on-floors: one side grips the rug, the other peels cleanly from the floor. Priced as an impulse buy at $5.98/roll. A national TV commercial begins airing soon.',
   'Pitch to retail buyers. Lead with the residue problem it solves and the impulse price point. Mention the TV spot.',
   'immediate', 0, '{4,6,8,12,16,20,24,28,32,36,40}', 12, false),

  ('DeckBond to Retailers', 'DeckBond', 'Andrew@deckbond.com', 'retailers',
   'DeckBond is a permanent deck joist tape that seals and protects joists from moisture to extend deck life. Product info: https://www.deckbond.com. Launch needs only 5" of shelf (case pack = one facing).',
   'Pitch to retail buyers. Emphasize durability and that nothing comparable is on DIY shelves.',
   'immediate', 0, '{4,6,8,12,16,20,24,28,32,36,40}', 12, false)
on conflict do nothing;

-- Seed Email 1 templates
insert into templates (campaign_id, step, subject, body)
select id, 1, 'PMI Tape Samples',
  'GREETING FIRST_NAME,

Have you had a chance to try out the SAMPLES samples?
I''d love to hear how our tape worked out for you all.

Thank you very much,'
from campaigns where name = 'PMI to Print Shops'
on conflict (campaign_id, step) do nothing;

-- PMI follow-up templates (steps 2-4): near-clones of email 1 with slight wording shifts.
insert into templates (campaign_id, step, subject, body)
select id, 2, 'PMI Tape Samples',
  'GREETING FIRST_NAME,

Have you had a chance to try out the SAMPLES samples? I''d love to hear how the tape worked for you all if so.

Thank you very much,'
from campaigns where name = 'PMI to Print Shops'
on conflict (campaign_id, step) do nothing;

insert into templates (campaign_id, step, subject, body)
select id, 3, 'PMI Tape Samples',
  'GREETING FIRST_NAME,

Have you had a chance to try out the SAMPLES samples from a few months ago? I''d love to hear how the tape worked for you all if so.

Thank you very much,'
from campaigns where name = 'PMI to Print Shops'
on conflict (campaign_id, step) do nothing;

insert into templates (campaign_id, step, subject, body)
select id, 4, 'PMI Tape Samples',
  'GREETING FIRST_NAME,

Have you had a chance to try out the SAMPLES samples from a while back? If there''s anything I can do to help just let me know.

Thank you very much,'
from campaigns where name = 'PMI to Print Shops'
on conflict (campaign_id, step) do nothing;

insert into templates (campaign_id, step, subject, body)
select id, 1, 'A flooring tape that''s stronger than glue',
  'GREETING FIRST_NAME, We manufacture a new flooring tape that is super permanent and unlike anything in the industry. It''s the first flooring tape that''s stronger than glue. Here''s some info on the product: https://www.floorbondtape.com/about-us. There is truly nothing like FloorBond on DIY shelves today. We have proven incremental and accretive to Flooring category sales at retail stores. To launch, we would only need 5" on your shelf (case pack enables one facing). If you''d like, we would be happy to stop by to show you this product in person. Just let me know. I really appreciate the opportunity.'
from campaigns where name = 'FloorBond to Retailers'
on conflict (campaign_id, step) do nothing;

insert into templates (campaign_id, step, subject, body)
select id, 1, 'A rug tape that leaves no residue',
  'GREETING FIRST_NAME, We''re launching a patent-pending rug tape called Tape Genie that solves one of the biggest complaints in this category — residue on floors. One side of Tape Genie grips the rug very well and the other side always peels cleanly from the floor. Tape Genie is priced to be an impulse purchase at $5.98/Roll. We''ve produced a national TV commercial that begins airing in a few weeks. If it would be helpful, I would be happy to stop by to show you this commercial before it airs and to go over Tape Genie in more detail. Just let me know! Thank you very much,'
from campaigns where name = 'Tape Genie to Retailers'
on conflict (campaign_id, step) do nothing;

insert into templates (campaign_id, step, subject, body)
select id, 1, 'A deck joist tape unlike anything on shelves',
  'GREETING FIRST_NAME, We manufacture DeckBond, a new deck joist tape that''s super permanent and unlike anything in the industry. It seals and protects deck joists from moisture to dramatically extend the life of a deck. Here''s some info on the product: https://www.deckbond.com. There''s truly nothing like DeckBond on DIY shelves today, and it has proven incremental and accretive to category sales at retail. To launch, we would only need 5" on your shelf (case pack enables one facing). If you''d like, we''d be happy to stop by to show you this product in person. Just let me know. I really appreciate the opportunity.'
from campaigns where name = 'DeckBond to Retailers'
on conflict (campaign_id, step) do nothing;

-- Zoho sample map (form value -> app sample option). Edit values to match your form.
insert into zoho_sample_map (form_field_value, sample_option) values
  ('Split Tape', 'Split Tape'),
  ('Full Adhesive Tape', 'Full Adhesive Tape'),
  ('Quick Rip Tape', 'Quick Rip Tape'),
  ('RED Tape', 'RED Tape'),
  ('PalletGel', 'PalletGel'),
  ('Dual-Tack Pallet Tape', 'Dual-Tack Pallet Tape')
on conflict (form_field_value) do nothing;
