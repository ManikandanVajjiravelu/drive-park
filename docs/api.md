# Usop public API (mobile + integrations)

All endpoints live under `/api/public/*`. Unless noted, send `Authorization: Bearer <Supabase access token>`.
Amounts are **paise** (integers) in payment responses; the client never sends prices — the server computes them.

## Common behaviour

- `Idempotency-Key: <uuid>` (optional, recommended) on `POST /bookings` and `POST /payments/order`. A repeat with the same key returns the first response.
- Rate limits are per user and fail closed: `429` with `Retry-After: <seconds>`.
- Errors: `{ "error": "message" }` with 400 (validation), 401 (auth), 403, 404, 409 (conflict: slot taken, hold limit, already paid, extension pending), 429, 500.

## Bookings — `POST /api/public/bookings`

Body: `{ "action": "create" | "extend" | "end" | "cancel", ... }`

- `create`: `{ slotId, startTime (ISO), duration, rateType: "hourly"|"daily"|"monthly", vehicleId?, promoCode? }`. `duration` limits: hourly 0.5–24 in 0.5 h steps; daily 1–30 whole days; monthly 1–12 whole months (400 otherwise). Optional `expectedTotal` (₹, before promo): if the server price differs by more than ₹1 the call fails with 409 "Price changed to ₹X…". A slot marked full by its host blocks only bookings starting within the next 2 hours. Returns the reservation with a 15‑minute `payment_expires_at` hold. Max 2 unexpired unpaid holds per user.
- `extend`: `{ reservationId, minutes }`. Stores a `pending_extension` (one at a time, 10‑minute expiry). The end time moves **only after** the extra payment is captured. If the slot was taken meanwhile, the extension payment is refunded automatically.
- `end`: `{ reservationId }`. Pro‑rata charge for time used, minimum 1 hour but never more than charged. Returns `{ finalPrice, refund }`.
- `cancel`: `{ reservationId }`. Only before start. Refund share follows the slot policy (see below). Returns `{ refunded }`.

## Payments

- `POST /api/public/payments/order` `{ reservationId }` → `{ orderId, amountPaise, keyId, purpose: "booking"|"extension"|"balance" }`. Amount = what is still due (price − paid + refunds, plus a pending extension). Any client `amount` is ignored.
- `POST /api/public/payments/verify` `{ reservationId, razorpay_order_id, razorpay_payment_id, razorpay_signature }` → `{ ok, status }`. Signature and order/payment/reservation ids are cross-checked; authorized payments are captured.
- `GET /api/public/payments/{reservationId}/status` → `{ paid, status, amountDuePaise, capturedPaise, refundedPaise, refundPendingPaise, pendingExtension }`.

## Profile — `GET /api/public/profile` and `POST /api/public/profile`

- `GET` → the caller's own `profiles` row (all columns). `404` if the profile is missing.
- `POST` body: `{ "name": string, "phone": string }`. Only `name` and `phone` are writable — `role`, `verification_status`, `verified`, `suspended*` and any other column are ignored even if sent. Validation matches the web app (`nameSchema`, `phoneSchema` from `src/lib/validation.ts`): name 2–50 chars of letters/space/`. ' -`; phone is a 10-digit Indian mobile starting 6–9. Returns the updated row.

## Vehicles — `GET /api/public/vehicles` and `POST /api/public/vehicles`

- `GET` → the caller's vehicles, newest first.
- `POST` body is a discriminated union on `action`:
  - `{ "action": "create", "plate": string, "make"?: string|null, "colour"?: string|null, "is_default"?: boolean }`. `plate` is normalised (uppercased, spaces/hyphens stripped) and validated against the Indian plate pattern (e.g. `TN01AB1234`). `make` is validated as a model name when present. The first vehicle for a user is automatically default unless `is_default` is set. Capped at 10 vehicles per user; returns `409` with `Vehicle limit reached` on create at the cap (app-level only — two concurrent creates at 9 may reach 11). Returns the created row. 
  - `{ "action": "delete", "id": uuid }` → `{ deleted: true, id }`. `404` if the vehicle is not the caller's.
  - `{ "action": "set_default", "id": uuid }` → sets `is_default` on `id` first, then clears it on the caller's other vehicles. Returns the updated row. `404` if not the caller's.

## Notifications — `GET /api/public/notifications` and `POST /api/public/notifications`

- `GET` → the caller's latest 50 notifications, newest first.
- `POST` body is a discriminated union on `action`:
  - `{ "action": "mark_read", "id": uuid }` → `{ updated: 1, id }`. `404` if not the caller's.
  - `{ "action": "mark_all_read" }` → `{ updated: n }` (number of unread rows flipped).

No bearer; verified by `X-Razorpay-Signature` (HMAC with `RAZORPAY_WEBHOOK_SECRET`). Replays dropped by `x-razorpay-event-id`. Events: `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`.

## Maintenance — `POST /api/public/cron/payments`

Internal token only. Expires unpaid holds, retries queued refunds (backoff), reconciles payments stuck >30 min in created/authorized.

## Rate limits (mobile endpoints)

Per-user, per-minute, POST only — GETs are unthrottled. Enforced by `rateLimit(userId, bucket)` in `src/lib/payments.server.ts`; values live in `REFUND_CONFIG.rateLimits` (`src/lib/refund-policy.ts`).

| Endpoint | Bucket | Limit |
|---|---|---|
| `POST /api/public/profile` | `mobile_profile` | 30/min |
| `POST /api/public/vehicles` | `mobile_vehicles` | 30/min |
| `POST /api/public/notifications` | `mobile_notifications` | 30/min |

Exceeding a limit returns `429` with the message `Too many requests. Please wait a minute and try again.`

## Refund policy (single source: `src/lib/refund-policy.ts`)

- Flexible: 100% until start. Moderate: 100% until 24h before, 50% inside. Strict: 100% until 48h before, 0% inside.
- Grace: 100% if cancelled within 10 min of booking/payment and start is ≥1h away.
- Late payment on an expired hold: booking reopens if the slot is still free and bookable; otherwise 100% refund.
- Refunds under ₹10 are skipped; GST refunded proportionally; Razorpay fees absorbed by the platform.
