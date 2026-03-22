# Pixora Product Spec (MVP)

## Problem

Users take many group photos and manually send them to each person. Pixora automates sharing by detecting who appears in each image.

## Goals

- Fast upload-to-share pipeline.
- Low false positive rate (privacy-sensitive).
- No paid infrastructure required at MVP launch.

## Non-goals (MVP)

- Public social feed/discovery.
- Advanced editing/filters.
- Video processing.

## User roles

- **Member**: enroll face, upload photos, receive auto-shared photos.
- **Group Admin**: manage members and group privacy.

## Core features

1. Account signup/login.
2. Face verification enrollment with consent.
3. Group creation/invite/join.
4. Multi-photo upload to a selected group.
5. Face detection + matching.
6. Auto-share for high-confidence matches.
7. Review queue for medium-confidence matches.
8. Controls: unshare/report/delete/export data.

## Success metrics

- P95 upload-to-result < 45s for 10 photos.
- False positive rate < 0.5% on validated set.
- Match recall > 90% under typical lighting.

## Matching policy

- High confidence: `score >= AUTO_SHARE_THRESHOLD`
- Medium confidence: `REVIEW_MIN <= score < AUTO_SHARE_THRESHOLD`
- Low confidence: no action

Default starting thresholds (to tune):
- `AUTO_SHARE_THRESHOLD = 0.62`
- `REVIEW_MIN = 0.48`

## Abuse prevention

- Per-user upload rate limits.
- File type/size validation.
- NSFW moderation optional phase 2.

## Roadmap

### Phase 1 (Weeks 1-2)
- Auth, groups, uploads, gallery skeleton.

### Phase 2 (Weeks 3-4)
- Enrollment + template lifecycle.

### Phase 3 (Weeks 5-6)
- Detection/matching + auto-share + review queue.

### Phase 4 (Weeks 7-8)
- Privacy controls, metrics dashboard, launch hardening.
