-- Pixora PostgreSQL Schema (Supabase)

create extension if not exists pgcrypto;
create extension if not exists vector;

create table if not exists profiles (
  id uuid primary key,
  username text unique not null,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  biometric_consent boolean not null,
  consent_version text not null,
  locale text,
  ip_hash text,
  created_at timestamptz not null default now()
);

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists group_members (
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  status text not null check (status in ('active', 'invited', 'removed')) default 'active',
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists face_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  embedding vector(512) not null,
  model_version text not null,
  is_primary boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_face_template_primary
on face_templates(user_id)
where is_primary = true;

create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  uploader_id uuid not null references profiles(id) on delete cascade,
  storage_key text not null,
  thumb_key text,
  status text not null check (status in ('queued', 'processing', 'processed', 'failed')) default 'queued',
  captured_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists photo_faces (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references photos(id) on delete cascade,
  bbox_x int not null,
  bbox_y int not null,
  bbox_w int not null,
  bbox_h int not null,
  quality_score numeric(5,4),
  embedding vector(512) not null,
  created_at timestamptz not null default now()
);

create table if not exists face_matches (
  id uuid primary key default gen_random_uuid(),
  photo_face_id uuid not null references photo_faces(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  confidence numeric(6,5) not null,
  decision text not null check (decision in ('auto_shared', 'pending_review', 'rejected', 'confirmed')),
  created_at timestamptz not null default now(),
  unique (photo_face_id, user_id)
);

create table if not exists shares (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references photos(id) on delete cascade,
  recipient_user_id uuid not null references profiles(id) on delete cascade,
  source_match_id uuid references face_matches(id) on delete set null,
  status text not null check (status in ('active', 'hidden', 'deleted')) default 'active',
  created_at timestamptz not null default now(),
  unique (photo_id, recipient_user_id)
);

create table if not exists review_queue (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references face_matches(id) on delete cascade,
  reviewer_user_id uuid,
  state text not null check (state in ('open', 'approved', 'rejected')) default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists processing_jobs (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references photos(id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'done', 'failed')) default 'queued',
  attempts int not null default 0,
  last_error text,
  scheduled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (photo_id)
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists enrollment_sessions (
  id text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_face_templates_embedding on face_templates using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists idx_photo_faces_embedding on photo_faces using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists idx_photos_group_created on photos(group_id, created_at desc);
create index if not exists idx_shares_recipient_created on shares(recipient_user_id, created_at desc);
