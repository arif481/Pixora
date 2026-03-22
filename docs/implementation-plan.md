# Implementation Plan (Execution-Ready)

## Milestone 0: Project bootstrap (2-3 days)

### Deliverables
- Next.js app initialized with auth shell.
- Supabase project + env wiring complete.
- SQL schema and RLS applied.

### Acceptance criteria
- User can sign up/sign in.
- User profile row auto-created.
- Group can be created and listed.

## Milestone 1: Upload pipeline (4-5 days)

### Tasks
- Implement signed upload URL endpoint.
- Implement client direct upload to private bucket.
- Register uploaded photo in `photos` table.
- Add queue insertion in `processing_jobs`.

### Acceptance criteria
- Uploading a photo results in `photos.status='queued'`.
- Job row exists for each uploaded photo.

## Milestone 2: Face enrollment (5-7 days)

### Tasks
- Build consent UI and API.
- Build enrollment session flow.
- Integrate face engine `/enroll` endpoint.
- Store template embedding in `face_templates`.

### Acceptance criteria
- Enrollment impossible without consent.
- Primary template saved and replaceable.

## Milestone 3: Detection + matching (7-10 days)

### Tasks
- Worker pulls queued jobs.
- Fetch image via signed URL and call `/detect-and-embed`.
- Insert `photo_faces` rows.
- Compare each face against active group members.
- Write `face_matches` decisions by confidence bucket.

### Acceptance criteria
- Processed photos have face + match records.
- High confidence matches create shares.
- Medium confidence matches appear in review queue.

## Milestone 4: Review and delivery UX (4-6 days)

### Tasks
- Recipient feed (`/shares/me`).
- Review queue page for pending matches.
- Confirm/reject actions.
- Share hide/remove controls.

### Acceptance criteria
- Users see shared photos where they are matched.
- Rejected match is not auto-shared again for same face.

## Milestone 5: Privacy + hardening (4-6 days)

### Tasks
- Data export and deletion workflows.
- Rate limits and file validation.
- Structured logs and alerting metrics.
- Threshold tuning on validation dataset.

### Acceptance criteria
- User can delete biometric and account data.
- Alert dashboard shows match rejection trends.

## Starter backlog (first 20 tickets)

1. Setup Next.js + Supabase SDK
2. Add auth guard middleware
3. Create profile bootstrap trigger/function
4. Implement create/list groups API
5. Add invite code generator
6. Add join group endpoint
7. Implement upload-url endpoint
8. Build multi-upload UI with progress
9. Register photo metadata endpoint
10. Add `processing_jobs` enqueue logic
11. Create worker process loop
12. Deploy FastAPI face engine skeleton
13. Add `/enroll` integration
14. Add consent capture page + backend
15. Add `/detect-and-embed` integration
16. Implement cosine similarity matcher
17. Add auto-share decision service
18. Build review queue UI
19. Add confirm/reject endpoints
20. Add shares feed and hide action

## Definition of done (MVP)

- End-to-end flow works for at least 20 real photos in a test group.
- No critical privacy issues in internal review.
- False-share rate under target on validation set.
- Operates within free-tier resource limits.
