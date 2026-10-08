# The Ballroom & The Bayu — Wedding Booking System

Dashboard + month tabs + filterable booking table + a "Tambah Booking" modal, backed by **Firebase Firestore** so every staff member's device sees the same live data.

No build step — plain HTML/CSS/JS. Open `index.html` directly, or run it with the VS Code **Live Server** extension. It needs an internet connection to reach Firebase.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell, Firebase SDK + config, topbar, tab bar, main view mount point, modals |
| `style.css` | Design tokens and all layout |
| `script.js` | App logic — dashboard stats, month table, booking form, admin login, Firestore sync |
| `README.md` | This file |

## What was broken, and the actual fix

**Symptom:** a booking would be entered, then immediately look deleted / "not found," even though nothing was ever clicked to delete it.

**Root cause — two separate bugs, both in the same area:**

1. **`index.html` was structurally broken.** It had two `</body>` tags before any `<body>` was opened, a `<head>` in the wrong place, and the Firebase SDK `<script>` tags loaded twice, with the app script referenced once under the wrong filename (`script_2.js`, which doesn't exist) and once correctly. Browsers "recover" from broken HTML in inconsistent ways, so this alone could cause unpredictable load order. **Fixed:** rewritten as one valid `<head>`/`<body>` document, Firebase SDKs and config loaded exactly once, `script.js` loaded once at the very end under its correct name.

2. **Every Firestore write was fire-and-forget, with no error handling and no waiting.** In the old code, saving a booking looked like this:
   ```js
   db.collection('bookings').doc(id).set(fields);   // not awaited, no .catch()
   showToast('Booking berjaya disimpan.');            // "saved" shown immediately regardless
   closeModal();
   openModal('bookingView', { id: id });               // reads state.bookings[id] right away
   ```
   `state.bookings` is only ever updated by Firestore's real-time listener (`onSnapshot`), which fires *after* the write round-trips to the server — that can be anywhere from a few milliseconds to never, if the write is silently rejected (for example by Firestore security rules). Opening the booking's detail view immediately, before that listener has fired, meant `state.bookings[id]` was often still empty, which triggered the app's own "this booking no longer exists" message — right after "successfully saved." If the underlying write was actually rejected (see the rules note below), the booking really would never appear, anywhere, with no error ever shown to explain why.

   **Fixed, throughout the whole file** (booking create/edit/delete, payment status, admin login/setup, password change, slot maintenance, removing a team member): every action now (1) updates the local view immediately, (2) sends the Firestore write, and (3) if that write fails, rolls the local change back and shows a toast with the *actual* Firebase error message. Nothing is ever shown as saved unless it's confirmed — and if it's not, you'll see why.

## ⚠️ Check your Firestore security rules

This app writes to Firestore with no sign-in step of its own (no Firebase Authentication) — it's the browser talking to Firestore directly using the config in `index.html`. That only works if your Firestore **security rules** allow it. In the Firebase Console, under Firestore Database → Rules, for a small internal tool like this you'd typically want something like:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

This is wide open — fine for an internal tool nobody outside your team knows the URL to, **not fine** if this page is ever made public, since anyone with the URL could read or edit every booking. If your rules are currently in Firestore's default "locked" mode (`allow read, write: if false;`) or the test-mode 30-day window has expired, every single write from this app would fail — which lines up exactly with bookings "not being in the database." With the fix above, that failure will now show up as a clear error toast instead of failing silently.

## What's on each screen

- **Dashboard tab** — total jobs this year / next year, jobs this month, jobs still upcoming, and totals per hall, followed by a "Next job" feed grouped by date with a days-left counter.
- **Month tabs** (current month + the next 17) — a banner + "Tambah Booking" shortcut, paid/unpaid counters for that month, filter pills (hall and session, combinable), and a table: Tarikh, Lokasi, Pengantin, Pakej, Majlis, Masa, Bayaran. Click any row to open its full detail. A booking whose optional details aren't all filled in yet shows a small "Perlu lengkap" chip under its name.
- **Tambah Booking modal** — split into two parts:
  - **Fields 1–6 (mandatory):** Staff Name, Client's Name, Contact Number, Package Type, Event Date, Event Session (Day/Night) — plus Lokasi Hall, required since it's what the booking is scheduled against.
  - **Fields 7–12 + Add-on (optional, fillable now or later):** Bridal Attire, Flower Bouquet, Makeup Artist, Groom Stylist, Photographer, Videographer, and an Add-on group (Bride's/Groom's Full Name + Contact Number) — collapsed under "Butiran & Add-on," which shows a live "x/11 lengkap" count and auto-expands whenever something's missing.
  - A booking's detail view shows that same count and a **"Lengkapkan Maklumat"** button when anything's outstanding.
- **Urus Pasukan (admin)** — a list of everyone who has signed in, with a "Remove" option for staff (not for the admin account or yourself), a form to change the admin password, and a tool to mark a specific hall/date/session as under maintenance.

## Admin login (password-gated)

- The **first time**, whoever is signed in sees a **"Setup Admin"** button, asking for an admin name and password. This creates the one admin account and logs that person in immediately.
- After that, everyone else sees **"Admin Log In"** instead, requiring that exact name and password. Typing the admin's name into the ordinary staff sign-in box does **not** grant admin rights.
- The admin can change the account's name/password later from "Urus Pasukan."
- Admin sessions don't carry over to a new browser tab — each tab needs its own password entry, by design.

**Security note:** the password is hashed (SHA-256) rather than stored as plain text, but this all runs client-side with the Firestore rules note above, so treat it as a UX gate, not real security. A determined person with access to your Firestore data (or to the page's JavaScript) is not meaningfully blocked by this. For real security, add Firebase Authentication and rules that check `request.auth`.

## Editing permissions

A booking can be edited or deleted by:
- **Admin** (logged in via the password above), for any booking, or
- **The staff member named in that booking's "Staff Name" field** — matched by name, not by which account happened to click "submit."

## Two note-worthy field differences from the ERD

1. **"Package Type"** uses your venue's own package tiers (Basic / Premium / custom).
2. **"Jenis Majlis"** (event type) isn't in your mandatory/optional field list, but it's still in the ERD, so it's kept as an optional field using common ceremony structures (Nikah Sahaja / Sanding Sahaja / Nikah & Sanding, or custom) rather than dropped.

## Customizing

- Vendor lists (makeup artists, photographers, bridal attire, ceremony types) are plain arrays near the top of `script.js`.
- Hall names/capacity live in `HALLS_DEFAULT` in `script.js` (halls themselves aren't stored in Firestore — only bookings, slot-maintenance flags, people, roles, and the admin account are).
- Colors, spacing and the light/dark palette are CSS variables at the top of `style.css`.
- Your Firebase project config lives at the top of `index.html`, inside the `firebaseConfig` object.
