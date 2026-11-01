# CivicLens Check the Fix — architecture

```mermaid
flowchart TD
  R[Resident browser\nReact + TypeScript + Vite] -->|Supabase Auth JWT| AUTH[Supabase Auth]
  R -->|create report RPC| DB[(PostgreSQL + RLS)]
  R -->|upload before photo| STORE[(Private Storage bucket)]
  REV[Authorized reviewer browser] -->|JWT + reviewer-only RPCs| DB
  REV -->|upload immutable after-photo| STORE
  REV -->|explicit request + signed URLs| EDGE[Supabase Edge Function]
  EDGE -->|server-side key only, if approved/enabled| VISION[Vision API]
  EDGE -->|save assessment against evidence ID| DB
  DB --> HIST[Append-oriented status/history and response records]
  DB --> REC[Human-decided recurrence links]
  R -->|own report/history/response| DB
```

- Browser code contains only the project URL and publishable/anon key. Privileged keys and vision provider secrets remain server-side.
- Private images are accessed using short-lived signed URLs after database/storage authorization.
- The original report photo path is not changed by the Check the Fix workflow. After-photos are separately stored and versioned.
- AI output is advisory and attached to a specific after-evidence ID and before-photo path. A later after-photo makes the older assessment non-current without deleting it.
- Status changes and history entries are written in the same database function transaction.
- Recurrence suggestions use a documented 150 m / 90-day default, category and data-class match, and prior reviewer-verified status. A reviewer decides the link; reports are not merged.
- Database owners/service-role administrators retain exceptional powers. The design is not described as tamper-proof.
