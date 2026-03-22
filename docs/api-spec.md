# Pixora API Spec (MVP)

Base URL: `/api/v1`
Auth: Bearer JWT (Supabase Auth)

## Auth + profile

### `GET /me`
- Returns user profile and enrollment status.

### `POST /me/consent`
- Stores biometric consent record.
- Body: `{ "biometricConsent": true, "version": "2026-03" }`

## Face enrollment

### `POST /face/enrollment/session`
- Creates enrollment session and signed upload target(s).

### `POST /face/enrollment/complete`
- Finalizes enrollment after upload.
- Body: `{ "sessionId": "..." }`
- Action: triggers face engine and stores `face_templates` row.

### `DELETE /face/enrollment`
- Revokes template and disables auto-matching.

## Groups

### `POST /groups`
- Body: `{ "name": "Trip Team" }`

### `GET /groups`
- Lists groups where requester is active member.

### `POST /groups/{groupId}/invite`
- Creates invite token/link.

### `POST /groups/join`
- Body: `{ "inviteCode": "..." }`

### `GET /groups/{groupId}/members`
- Lists members and enrollment states.

## Photos

### `POST /groups/{groupId}/photos/upload-url`
- Body: `{ "filename": "img_01.jpg", "contentType": "image/jpeg", "size": 3451111 }`
- Returns signed URL + storage key.

### `POST /groups/{groupId}/photos`
- Register uploaded object.
- Body: `{ "storageKey": "...", "capturedAt": "2026-03-20T10:12:00Z" }`
- Returns `photoId` and processing status.

### `GET /groups/{groupId}/photos`
- Paginated photos visible to requester.

### `GET /photos/{photoId}`
- Full metadata + faces + share state for requester.

## Processing + matches

### `POST /internal/photos/{photoId}/process`
- Internal endpoint used by worker.

### `GET /photos/{photoId}/matches`
- Match candidates for uploader/admin/reviewer.

### `POST /matches/{matchId}/confirm`
- Confirms medium-confidence match and creates share.

### `POST /matches/{matchId}/reject`
- Rejects candidate; model feedback logged.

## Shares

### `GET /shares/me`
- Photos shared with current user.

### `DELETE /shares/{shareId}`
- Hide/remove share for recipient.

## Privacy operations

### `POST /me/export`
- Start async export job.

### `DELETE /me/data`
- Starts account + biometric + photo data deletion workflow.

## Webhooks/events (optional)

- `photo.processed`
- `photo.failed`
- `share.created`
- `review.required`
