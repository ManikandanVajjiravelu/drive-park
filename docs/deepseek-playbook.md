# DeepSeek playbook for Usop

Put this file and scenarios.md in the docs/ folder. Do the tasks in order. One task per Aider session.
Risk labels: SAFE (no money, no database change), CAREFUL (touches bookings or needs a migration), MONEY (changes how money moves; you read every line).

## How to run every task

1. Open PowerShell and run:
   cd $HOME\drive-park
   aider --no-gitignore --cache-prompts --model deepseek/deepseek-chat --read AGENTS.md --read docs/scenarios.md
   (If the model is not found, use deepseek/deepseek-v4-flash. Answer N to release notes.)
2. Add the files the task lists with /add. Paste the prompt as ONE line.
3. For CAREFUL and MONEY tasks, plan first. Run /ask with the PLAN prompt, read the answer, and only then paste the BUILD prompt.
4. Say N to any request to add routeTree.gen.ts, .env, bun.lock, package.json, vite.config.ts or anything in src/integrations/ or supabase/ unless the task says so.
5. Check: /run bun run typecheck and /run bun run test (answer Y to let it fix errors). Then /exit.
6. In a normal PowerShell window: git --no-pager diff --stat origin/main HEAD
   You should see only the files you expect, each with a small number of changed lines.
   Hundreds of changed lines in one file means line-ending noise: stop and ask for help.
7. If the task added or removed route files: run bun run dev for 10 seconds, stop it, and commit src/routeTree.gen.ts too.
8. Push: git push origin main. Never use --force. Never use git add . or git commit -a.
9. Look at the change in the browser (bun run dev) before moving on.

If DeepSeek goes wrong: type /undo in Aider (it reverts its last commit), then /clear and try a smaller prompt.

## Task list

### T1. Privacy and terms polish. SAFE
Add: src/routes/privacy.tsx src/routes/terms.tsx public/sitemap.xml roadmap.md
Prompt (replace YOUR_EMAIL_HERE):
In src/routes/privacy.tsx change "by emailing us" to "by emailing YOUR_EMAIL_HERE". Add a small "Last updated: October 2026" line under the intro text in both privacy.tsx and terms.tsx. In privacy.tsx add two Sections after "Where data is stored": "Your location" saying that the exact address of a parking space is shown to a driver only after a booking is fully paid, and before that only an approximate area is shown, and "How long we keep data" saying account data is kept while the account is active and booking and payment records are kept as long as the law requires. In public/sitemap.xml add url entries for https://www.usop.in/privacy and https://www.usop.in/terms. In roadmap.md change "- [ ] Privacy policy and terms pages" to "- [x] Privacy policy and terms pages". Change nothing else.

### T2. Send the destination to the server search. SAFE (S5)
Add: src/routes/_authenticated/map.tsx
Prompt:
In src/routes/_authenticated/map.tsx add lat and lng (numbers) to the WindowQuery type, and in submitWindow include lat: anchor[0] and lng: anchor[1] in the object passed to setWin so the server search receives the destination (or the user's location when there is no destination). Change nothing else.

### T3. Several identical spaces. SAFE (S3)
Add: src/components/SlotForm.tsx
Prompt:
In src/components/SlotForm.tsx, in create mode only, add a "Number of identical spaces" number field (1 to 10, default 1). On save, insert that many rows into slots using the same payload, with "1", "2", "3" appended to the name when the count is more than 1 (keep the name unchanged when it is 1), and show the toast "N slots added". Keep the existing validation, owner_id and status handling, and leave edit mode unchanged.

### T4. Rate limits and vehicle cap on the mobile endpoints. CAREFUL (S23)
Add: src/routes/api/public/profile/index.ts src/routes/api/public/vehicles/index.ts src/routes/api/public/notifications/index.ts
Also /read src/lib/api-auth.ts and /read src/routes/api/public/bookings/index.ts
Prompt:
Add per-user rate limiting to the three mobile endpoints using the same mechanism the bookings endpoints use (find it in src/lib/api-auth.ts and the rateLimits section of src/lib/refund-policy.ts, and add only the new keys mobile_profile, mobile_vehicles and mobile_notifications with 30 requests per minute each), cap each user at 10 vehicles by returning a 409 with the message "Vehicle limit reached" on create, and make set_default atomic so a failed second update cannot leave the user with no default vehicle. Do not change any other rate limit, payment, booking, pricing or refund logic, and do not create database migrations. Document the limits in docs/api.md.

### T5. Get directions after payment. CAREFUL (privacy rule)
Add: src/routes/_authenticated/reservations.tsx src/routes/_authenticated/slot.$id.tsx
Prompt:
Find where the unlocked full address is already shown to a driver for a paid booking and add a "Get directions" button there that opens https://www.google.com/maps/dir/?api=1&destination= followed by the URL-encoded address already available on that screen. Do not fetch, select or expose any new location fields, do not change how or when the address is unlocked, and do not add the button anywhere the address is not already shown.

### T6. Owner blocks a date and time range. CAREFUL (S2, needs a migration)
Plan prompt (/ask):
Read docs/scenarios.md section S2 and AGENTS.md. Do not write code. List the files you would change, the new table and columns, how blocked ranges would be counted in src/lib/search.server.ts, src/lib/quote.ts and src/lib/bookings.server.ts, what could go wrong, and which tests you would add. Wait for my approval.
Build prompt (after you approve the plan):
Implement scenario S2 from docs/scenarios.md exactly as planned: a slot_blocks table with an additive migration following the migration process in AGENTS.md, row-level security so only the owner of the slot can read and write their blocks, an owner screen to add and remove blocks, and blocked ranges treated like existing reservations in search, quote and createBooking. Refuse a block that overlaps a paid booking. Add Vitest tests in tests/ and change nothing unrelated.
Note: test with this one small migration first to learn whether Lovable Cloud applies migrations pushed from GitHub when you have no credits.

### T7. Driver reports "Can't park". CAREFUL (S6)
Plan prompt (/ask):
Read docs/scenarios.md section S6 and the existing admin disputes code in src/routes/_authenticated/admin/disputes.tsx and src/lib/admin-queries.ts. Do not write code. List the files and any table or column changes you would need so a driver can open a "can't park" dispute with a photo during an active booking, the owner is notified, and the admin sees it. Wait for my approval.
Build prompt: Implement scenario S6 from docs/scenarios.md exactly as planned. Do not issue refunds automatically in this step; only create the dispute, the notification and the admin view. Add tests and change nothing unrelated.

### T8. Overstay phase 1. CAREFUL (S8)
Plan prompt (/ask):
Read docs/scenarios.md section S8 phase 1. Do not write code. List how you would send the driver an end-of-booking reminder with an Extend option, add a Report overstay button for the owner that opens a dispute of type overstay, and show it in the admin disputes screen, using the existing notifications, extension and disputes code. Wait for my approval.
Build prompt: Implement scenario S8 phase 1 from docs/scenarios.md exactly as planned. Charge nothing in this step. Add tests and change nothing unrelated.

### T9. Owner cancels a booking. MONEY (S11)
Read every changed line yourself before committing. Run the live-mode test (T14) after this.
Plan prompt (/ask):
Read docs/scenarios.md section S11 and src/lib/bookings.server.ts, src/lib/payments.server.ts and src/lib/refund-policy.ts. Do not write code. Explain how an owner cancellation would refund the driver in full including fees through the existing refund path, how strikes would be stored, how the freed time slot is released, and every risk of double refunds. Wait for my approval.
Build prompt: Implement scenario S11 from docs/scenarios.md exactly as planned, reusing the existing refund code path and its idempotency protections instead of writing a new one. Add Vitest tests, including a test that cancelling twice refunds once, and change nothing unrelated.

### T10. Landowner payouts, manual. MONEY (S15, needs a migration)
Decide the open point in S15 (refunds after payout) first.
Plan prompt (/ask):
Read docs/scenarios.md section S15, src/routes/_authenticated/earnings.tsx and src/routes/_authenticated/admin/revenue.tsx. Do not write code. List the new tables (payout details, payouts), the row-level security rules, how an earning becomes payable after the booking is completed plus 48 hours with no open dispute, the admin screen to mark payouts as paid with a reference, and what the owner sees. Wait for my approval.
Build prompt: Implement scenario S15 from docs/scenarios.md exactly as planned. Do not move any money automatically. Bank and UPI details must be readable only by their owner and admins. Add tests and change nothing unrelated.

### T11. Landowner verification. CAREFUL (S17, needs a migration and a private storage bucket)
Plan prompt (/ask):
Read docs/scenarios.md section S17 and the approval flow in src/routes/_authenticated/admin/listings.tsx. Do not write code. List the new table or columns, the private storage bucket and its access rules, the owner upload screen, and how admin approval is recorded and required before a space goes live. Wait for my approval.
Build prompt: Implement scenario S17 from docs/scenarios.md exactly as planned. Documents must be readable only by their owner and admins and never publicly. Add tests and change nothing unrelated.

### T12. Tests and CI. SAFE
Prompt (use /ask first, then build):
Read tests/money.db.test.ts and .github/workflows/ci.yml. Explain why the database tests skip, and propose how to run them in CI against a disposable test database without using production data. Do not change payment code.

### T13. Account deletion and data export. CAREFUL (S22)
Do this after a lawyer says what must be kept. Plan with /ask first, same pattern as T6.

### T14. Live-mode payment test. DONE BY YOU, NOT DEEPSEEK
Use live Razorpay keys on the real site with small amounts. Check each result in the Usop admin screens and the Razorpay dashboard.
1. Book and pay for a short slot. 2. Extend it. 3. Cancel another booking before it starts and confirm the refund. 4. Let one payment fail or time out. 5. Confirm the webhook retried and nothing was charged twice.
Run it after T9 and T10.

### Decisions only you can make (DeepSeek cannot)
- Overstay rules and charges (S8 phase 2), owner strike thresholds (S11), the dispute response time (S6).
- Refunds after a payout (S15), GST treatment (S16, ask an accountant), liability and towing terms (S19, ask a lawyer).
- What proof of ownership you accept (S17).
