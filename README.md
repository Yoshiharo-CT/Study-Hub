# Study Hub Space Availability & Reservation System (v2)

A PHP (PDO) + vanilla JavaScript Fetch implementation of the full
Phase 0–11 flow you specified, on top of your original
`study_hub_db.sql` schema.

## What this build adds on top of your uploaded files

Your upload had `index.html`, `login.html`, `study_hub_db.sql`, and a
README describing an `api/` and `assets/` layer that wasn't actually
in the zip. This build fills in that entire missing layer and extends
the schema/UI so every phase in your flow document is implemented:

| Flow phase              | What was added                                                                                                                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Init                | `api/setup.php` creates the admin; `space_types`/`study_spaces`/`products_services` seeded in `study_hub_db.sql`                                                                                                                                            |
| 1 — Registration/Login  | `api/auth.php` (`login`, `memberRegister`, `me`, `logout`), session-based staff/customer auth                                                                                                                                                               |
| 2 — Browse/Availability | `api/spaces.php` (`listSpaces`, `checkAvailability` — excludes overlapping reservations _and_ scheduled maintenance)                                                                                                                                        |
| 3 — Reservation         | Customer dashboard offers fixed one-hour slots from 8:00 AM to 5:00 PM and checks availability before booking; `api/reservations.php` enforces customer slot, overlap, capacity, and maintenance rules and emails request/confirmation updates; staff can `confirm`, `cancel`, or `noShow` |
| 4 — Walk-in             | **New** `walkin_queue` table + `api/walkin.php` (`add`, `list`, `cancel`); auto-served on check-out                                                                                                                                                         |
| 5 — Reserved check-in   | `api/sessions.php` `checkIn` (accepts `reservation_id`, marks reservation completed)                                                                                                                                                                        |
| 6 — Active session      | `checkIn` issues a Wi-Fi password (**new** `space_sessions.wifi_password` column); `extendSession` writes to `session_extensions`; `api/orders.php` writes `order_items` + `printing_jobs` and decrements stock; `api/promotions.php` validates promo codes |
| 7 — Billing             | `api/billing.php` `create` sums session fee + extensions + order total, applies a promo, and stores `subtotal`/`discount_amount` (**new** columns on `billing_transactions`)                                                                                |
| 8 — Payment             | `api/payments.php` `record`/`verify`/`reject`; auto-flips `pending → partially_paid → paid`; issues an immutable row in the **new** `receipts` table once fully paid                                                                                        |
| 9 — Check-out           | `sessions.php` `checkOut` computes the fee from elapsed hours × the space's base rate, frees the space, and serves the next matching walk-in from the queue                                                                                                 |
| 10 — Reporting          | `api/reports.php` (`dashboard`, `spaceAvailability`, `dailyRevenue`, `activeSessionsView`, `auditLog`); **new** `audit_log` table written by every mutating endpoint via `log_audit()`; `api/staff.php` `setStatus` to suspend/reactivate staff             |
| 11 — End of day         | `reports.php` `endOfDay` (revenue, session/walk-in counts, top products, outstanding balances); `markOverdueNoShows`; `promotions.php` `deactivateExpired`; re-import `study_hub_db.sql` for backup/restore                                                 |

**New tables**: `notifications`, `audit_log`, `walkin_queue`,
`space_maintenance`, `promotions`, `receipts`.
**New columns**: `space_sessions.wifi_password`,
`billing_transactions.subtotal/discount_amount/promotion_id`,
`orders.session_id`, `payments.notes`.
**New views**: `v_daily_revenue`, `v_active_sessions`.

One deliberate deviation from the doc: space-status flips
(`available ⇄ occupied ⇄ reserved`) are done in PHP inside the same
DB transaction as the triggering action, rather than as MySQL
triggers — this keeps the whole state change (rows + status +
notification + audit log) atomic and easy to debug in one place,
with identical end results.

## Setup (XAMPP)

1. Start Apache and MySQL.
2. Import `study_hub_db.sql` fresh into phpMyAdmin (it drops and
   recreates every table — don't import it on top of your old dump).
3. Confirm `api/connection-pdo.php` matches your MySQL setup
   (defaults: `127.0.0.1` / `root` / no password).
4. Visit `http://localhost/Study%20Hub/api/setup.php` once — creates
   the admin login if missing.
5. Open `http://localhost/Study%20Hub/login.html`.
6. Configure PHP's `mail()` transport in XAMPP (or a local sendmail relay)
   with a verified sender address before expecting reservation emails to be
   delivered. Update the `From` address in `api/reservations.php` to match
   that sender. The app reports when an email could not be sent.
7. Customer bookings use fixed one-hour slots from 9:00 AM–10:00 AM through
   8:00 PM–9:00 PM. The customer dashboard shares the staff application's
   warm coffee-brown and cream stylesheet, including its light/dark theme.

For an existing database, run `migrations/remove_tax.sql` once to remove the
tax settings, category tax flag, and stored transaction tax values.

## Seeded logins

These development credentials correspond to the hashes in the `users` seed below. Change them before using this project outside a local development environment.

| Username          | Type          | Plaintext password | SQL password hash                                              |
| ----------------- | ------------- | ------------------ | -------------------------------------------------------------- |
| `juan.delacruz`   | Customer      | `Juan123`          | `$2y$10$PnYHhSnG7odiSBULLlEmRO8saZdttD7BnInxBRmgHMWksgRMMCGkm` |
| `maria.santos`    | Customer      | `Maria123`         | `$2y$10$6HsxzXpeaMh/eGN/2OV7/.Pb50bsqUWnub/SrFfSYUhr7WWIfFaQK` |
| `pedro.reyes`     | Customer      | `Pedro123`         | `$2y$10$gyWuNlt9kamNFMPh/7YxP.yg7R10mve72h6fW5BgdpeijF6GKl6BK` |
| `ana.garcia`      | Customer      | `Ana123`           | `$2y$10$5ZSPOGE0gD/UR6OOrgv57.zPGciIR4xFYjfv3z4a/.jg0RFk894T6` |
| `carlo.mendoza`   | Staff         | `Carlo123`         | `$2y$10$t/chyzCAEoj8SPM9w8f.WOOMNi5kc.dJTlPf9y6sBeWslrhD73DqW` |
| `liza.torres`     | Staff         | `Liza123`          | `$2y$10$1otKMByoMbM/vki2vOSN2O78PhK0DZoipSf9a7.DlPyW0kcoPummS` |
| `mark.villanueva` | Staff         | `Mark123`          | `$2y$10$yrbB7uifBcZpFdsnm5QO8eF.EWs2eK0eMXHnR9aE3/bdLbWZ2jDWC` |
| `rica.fernandez`  | Staff         | `Rica123`          | `$2y$10$LiPFyn2jOZD0WoyEzuGMIeSNlbB.TLcmsSvi5VJZc4xQN5.L0UfT6` |
| `admin`           | Owner/Manager | `System123`        | `$2y$10$f2u3KDsgi1EioUHeABfmAOrrijSiROlkstJVPOiJFdIrCSOyfwiSC` |

`setup.php` uses `admin` / `admin123` only when it creates a brand-new admin account. The seeded admin is linked to the `System Admin` staff record, so its seeded password follows that first name: `System123`.

## Folder structure

```
Study Hub/
  study_hub_db.sql
  login.html
  index.html
  api/
    connection-pdo.php   PDO connection + session/permission/audit/notification helpers
    auth.php              login, memberRegister, me, logout
    customers.php          list/get/add
    staff.php               list/roles/add/setStatus
    spaces.php               types + spaces + checkAvailability + maintenance
    reservations.php          create (overlap-checked) / confirm / cancel / noShow
    sessions.php               checkIn (+ Wi-Fi) / extendSession / checkOut (+ auto-serve queue)
    walkin.php                  add / list / cancel
    products.php                  categories / products / paper sizes / print types
    orders.php                     create (order_items + printing_jobs + stock) / list
    promotions.php                  list / validate / add / deactivateExpired
    billing.php                      create (consolidate + promo + tax) / list / get
    payments.php                      record / verify / reject / receipt
    notifications.php                  list / markRead / markAllRead
    reports.php                         dashboard / views / auditLog / endOfDay / markOverdueNoShows
    setup.php                            one-time admin bootstrap
  assets/
    css/style.css
    js/config.js           API base URL + fetch client
    js/app.js               all frontend logic
```

All `api/*.php` files except `auth.php` and `setup.php` require an
active staff session (`require_staff_login()`); mutating endpoints
additionally check the logged-in staff member's role permissions
(`require_permission('...')`), matching `staff_roles.permissions`.
