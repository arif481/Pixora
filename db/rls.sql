-- Enable RLS
alter table profiles enable row level security;
alter table consent_records enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table face_templates enable row level security;
alter table photos enable row level security;
alter table photo_faces enable row level security;
alter table face_matches enable row level security;
alter table shares enable row level security;
alter table review_queue enable row level security;
alter table processing_jobs enable row level security;
alter table audit_logs enable row level security;

-- Profiles: self read/write
create policy profiles_self_select on profiles for select using (id = auth.uid());
create policy profiles_self_update on profiles for update using (id = auth.uid());

-- Group membership helper via EXISTS

create policy groups_member_select on groups
for select using (
  exists (
    select 1 from group_members gm
    where gm.group_id = groups.id and gm.user_id = auth.uid() and gm.status = 'active'
  )
);

create policy groups_owner_insert on groups
for insert with check (owner_id = auth.uid());

create policy group_members_member_select on group_members
for select using (
  user_id = auth.uid() or exists (
    select 1 from group_members gm
    where gm.group_id = group_members.group_id and gm.user_id = auth.uid() and gm.status = 'active'
  )
);

create policy photos_member_select on photos
for select using (
  exists (
    select 1 from group_members gm
    where gm.group_id = photos.group_id and gm.user_id = auth.uid() and gm.status = 'active'
  )
);

create policy photos_member_insert on photos
for insert with check (
  uploader_id = auth.uid() and exists (
    select 1 from group_members gm
    where gm.group_id = photos.group_id and gm.user_id = auth.uid() and gm.status = 'active'
  )
);

create policy shares_recipient_select on shares
for select using (recipient_user_id = auth.uid());

create policy shares_recipient_update on shares
for update using (recipient_user_id = auth.uid());

create policy face_templates_self_select on face_templates
for select using (user_id = auth.uid());

create policy face_templates_self_modify on face_templates
for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy consent_self_select on consent_records
for select using (user_id = auth.uid());

create policy consent_self_insert on consent_records
for insert with check (user_id = auth.uid());

-- Lock internal tables from direct client writes (service role bypasses RLS)
create policy photo_faces_no_client on photo_faces
for all using (false) with check (false);

create policy face_matches_no_client on face_matches
for all using (false) with check (false);

create policy review_queue_no_client on review_queue
for all using (false) with check (false);

create policy processing_jobs_no_client on processing_jobs
for all using (false) with check (false);

create policy audit_logs_no_client on audit_logs
for all using (false) with check (false);
