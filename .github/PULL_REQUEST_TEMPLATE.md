## What changed

<!-- 1-3 lines: what this pull request does, and why. -->

## Checklist

- [ ] The changed files are exactly the files the task asked for (nothing extra, nothing missing).
- [ ] SQL: reviewed, applied to usop-test first, and every new `drizzle/migrations/*.sql` has an entry in `drizzle/migrations/meta/_journal.json`. (Skip if there is no SQL.)
- [ ] Money or permissions: every changed line was reviewed by a human. (Skip if this touches neither.)
- [ ] No secrets, `.env` files, lockfiles, seed scripts or helper scripts in the diff.
- [ ] `node scripts/check-repo.mjs`, `npx tsc --noEmit` and the tests are green.
- [ ] New personal data collected? The privacy page is updated. (Skip if no new personal data.)
- [ ] How to roll back: <!-- revert this commit, re-run which migration, restore which setting -->
