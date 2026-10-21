# Usop scenarios and rules

Written 21 Oct 2026 from a read of the repo and of what other parking apps (SpotHero, JustPark, YourParkingSpace) do.
Status: DONE = already in the code. TODO = to build. DECIDE = needs a business, legal or tax decision before code.
Values marked "proposed" are defaults. The owner of the project edits them before building.

Rules for every change: follow AGENTS.md; never expose exact lat/lng or full address before a booking is paid;
read slots with SLOT_COLUMNS, never `*`; clients never send prices; money rules live in src/lib/refund-policy.ts
and src/lib/money.ts; every new rule gets a Vitest test in tests/.

## 1. Booking and availability

S1 Double booking. DONE. The database refuses overlapping bookings on one space (reservations_no_overlap).

S2 Owner's own car or any owner-blocked time. TODO.
- The owner can block a space for a date and time range (for example "Friday 9:00 to 17:00, my own car").
- A blocked range counts like an existing booking in search, quotes and booking creation, so it can never be booked.
- An owner cannot block a range that already has a paid booking. They must cancel that booking first (S10).
- "Marked full" stays as it is (stops bookings for the current time only).

S3 Several identical spaces at one address. TODO (small).
- The add form has a "Number of identical spaces" field (1 to 10). It creates that many separate spaces named "Name 1", "Name 2", and so on.
- Each is approved by an admin separately.

S4 Grouped view ("3 spaces here, 2 available") with a seat-style chooser. LATER, after verification and payouts.

S5 Nearest-first search. DONE on the server. TODO on the map page: the destination (or the user's location) must be sent to the server search
so the 100 nearest spaces are returned, not the first 100 by id.

## 2. Problems at arrival

S6 Space occupied or blocked when the driver arrives. TODO.
- The driver taps "Can't park" during the booking window and can attach a photo. This opens a dispute (the admin disputes screen already exists).
- The owner is notified and has 2 hours (proposed) to resolve it by message.
- If the dispute is upheld or the owner does not respond, the driver gets a full refund and the owner gets a strike (see S10).

S7 Driver late. DONE (no new work). The booking stays valid inside its window and unused time is not refunded.

S8 Driver overstays. TODO in two phases.
- Phase 1 (no money): 15 minutes (proposed) before the end, notify the driver with an "Extend" option if the space is free.
  At the end time plus a 10 minute grace (proposed), the owner sees a "Report overstay" button that opens a dispute of type overstay.
- Phase 2 (money, human review): the admin can add an overstay charge of the extra hours at the hourly rate (the multiplier is DECIDE).
  Three upheld overstays (proposed) pause the driver's ability to book until an admin reviews.

S9 Vehicle too big. TODO to verify. A booking must be refused if the vehicle's known height, width or size exceeds the space's limits.
First check what is enforced today.

## 3. Cancellations

S10 Driver cancels. DONE (refund-policy.ts: flexible, moderate and strict, plus a 10 minute grace).

S11 Owner cancels an upcoming booking. TODO (money).
- The owner can cancel from their bookings screen. The driver gets an automatic full refund including fees.
- Each owner cancellation adds a strike. Three strikes in 90 days (proposed) pause the owner's listings for admin review.
- Cancelling a booking that starts within 24 hours (proposed) is allowed but gives a strike and notifies an admin.
- Cancelling a booking already in progress is admin-only.
- A cancellation by the owner frees the time slot again.

## 4. Money

S12 Payment webhook retries and reconciliation. DONE.
S13 Unpaid holds. DONE (15 minutes, at most 2 per user, rate limits).
S14 Price change between viewing and paying. DONE (409 price-changed).

S15 Landowner payouts. TODO (money, manual for the pilot).
- Owners add their UPI ID or bank details (private to them and admins, protected by row-level security).
- An earning becomes payable when the booking is completed plus 48 hours (proposed) with no open dispute.
- The admin pays outside the app and marks the payout as paid with a reference number. The owner sees pending, payable and paid.
- Payout amount is the booking amount minus PLATFORM_COMMISSION_RATE.
- A refund after payout is recovered from the owner's next payouts. DECIDE.

S16 GST and invoices. DECIDE. An accountant decides the tax treatment (see the TODO in src/lib/pricing.ts). Then add a receipt per booking.

## 5. Trust and safety

S17 Landowner verification. TODO.
- The owner uploads an ID proof and an ownership document (for example a property paper or tax receipt) to a private storage bucket.
- Only the owner and admins can read them. A space stays "pending" until an admin approves the documents and the listing.
- Admins record who approved and when.

S18 Fake or abusive users. PARTLY. Admins can review. Add user reports and suspension if not present.
S19 Damage, theft, towing and insurance. DECIDE with a lawyer. Update the terms afterwards.
S20 Festival surge pricing. TO VERIFY. Check whether demand pricing has a maximum multiplier. If not, add one (proposed 2x base).

## 6. Data and privacy

S21 Exact address hidden until paid. DONE. Every new endpoint and screen must keep it.
S22 Account deletion and data export. TODO after legal advice. Remove or anonymise personal data but keep booking and payment records as the law requires.
S23 Mobile endpoints (profile, vehicles, notifications). DONE. TODO: per-user rate limits and a vehicle cap of 10.
