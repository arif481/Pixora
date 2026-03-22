# Security & Privacy Blueprint

## Biometric consent requirements

- Explicit opt-in before enrollment.
- Consent record includes version, timestamp, locale, IP hash.
- Enrollment blocked until consent exists.

## Data minimization

- Store face embeddings, not raw biometric images, when possible.
- Enrollment artifacts auto-delete after successful template generation (configurable retention).

## Access control

- Row Level Security on all user data tables.
- Group-scoped visibility for photos/matches/shares.
- Signed URLs for object reads with short TTL (e.g., 60-120 seconds).

## Encryption

- TLS in transit.
- At-rest encryption via managed providers.
- Optional app-layer encryption for embedding payloads using KMS-managed key.

## User rights

- Delete template.
- Delete account and linked biometric/profile records.
- Export data archive.

## Audit and incident response

- Audit logs for enrollment, matching decision, share creation/deletion.
- Alerting on abnormal match rejection spikes.
- Playbook for false-share incident: revoke share, notify users, retrain threshold.

## Compliance checklist (adapt to jurisdiction)

- Privacy Policy with biometric section.
- Terms of Service with prohibited content and abuse clauses.
- Data Processing Agreement if serving business users.
- Regional legal review before production launch.
