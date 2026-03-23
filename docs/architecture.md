# Pixora Architecture

## 1) High-level components

1. **Web App (Next.js)**
   - User auth, group management, upload UI, galleries, review queue.
2. **Application API (Next.js Route Handlers / BFF)**
   - Validates auth, signs uploads, triggers processing jobs, writes share records.
3. **Database (Supabase Postgres)**
   - Users/groups/photos/faces/matches/shares/audit logs.
4. **Object Storage (Supabase Storage)**
   - Original photos, thumbnails, optional enrollment selfie artifacts.

## 2) Event flow

### A. Face enrollment

- User consents to biometric processing.
- User submits selfie set or short challenge video.
- Browser extracts face embedding on-device and reports quality metadata.
- App stores template in `face_templates` linked to user.

### B. Photo upload + processing

- Client requests signed upload URL.
- Client uploads photo directly to storage bucket.
- Browser detects faces and computes embeddings on-device.
- App creates `photos` row with `status='queued'`.
- App stores detected face rows in `photo_faces` at registration time.
- Worker picks photo and reads `photo_faces`.
- Matcher compares to templates of group members only.
- Match results stored in `face_matches`.
- Auto-share created for high confidence; medium confidence goes to `review_queue`.

### C. Delivery

- Shared photos appear in recipient feed via `shares` rows.
- Notifications (in-app/email/push) triggered for new shares.

## 3) Trust boundaries

- Browser never sees private face templates of other users.
- Storage object keys are private; access only through short-lived signed URLs.
- Embeddings are generated on-device in the uploader/enrollment browser session.

## 4) Failure handling

- Job retries with exponential backoff.
- Permanent failure marks `photos.status='failed'` and logs diagnostic in `audit_logs`.
- Idempotent processing key: `(photo_face_id, user_id)`.

## 5) Scalability notes

- Start with DB-driven job queue (`processing_jobs`) for MVP.
- Scale to Redis queue when throughput grows.
- Pre-compute template index per group for faster matching.
