# Exception Agent (US Pizza Operations hub, /exception)

Operations upload the Codemax/FeedMe **Sales Summary Listing** every morning. Each outlet's daily net sales are kept
(Supabase schema `exception_agent`) and every uploaded day is checked: what should the outlet have sold that day,
judged only from the days before it? **Chronos-2** (Amazon's pretrained forecasting model, on Modal — `../modal_app.py`,
endpoint `expect`) answers with an expected figure and a normal range; when it can't be reached, the outlet's usual sales
for that weekday are used. A day below **half** of expected is an exception (`no sales` = sold the week before, missing
from the report). New exceptions go as one push per person to operations (HOD) and the outlet's area manager, in their
language, and to the hub's notification centre. Outlet / area managers see their own outlets on the board and can mark
an exception "looking into it" / resolved with a note.

Outlets are matched by **name** (the report's codes are not the hub's: report 002 = Kota Warisan, hub 002 = Ampang).
MFM, franchises and anything the hub doesn't monitor are skipped. A name that matches nothing is shown after the upload
with an outlet picker (saved in `exception_agent.outlet_aliases`).

| Path | What |
|---|---|
| `worker/index.js` | routes (`/api/data`, `/api/import`, `/api/detect`, `/api/notify`, `/api/alias`, `/api/exceptions/:id`) |
| `worker/detect.js` | expectation (Chronos-2 / weekday baseline) and exceptions for some days |
| `worker/rules.js` | thresholds, name matching, baseline, judging (tested) |
| `worker/notify.js`, `worker/messages.js` | summary pushes + notification centre, 4 languages |
| `src/` | the board (React); `src/importers.js` reads the Excel export in the browser (tested) |
| `supabase/001_exception_agent.sql` | tables (already applied to the project) |

## Deploy (once)
1. Supabase → Project Settings → **Data API → Exposed schemas**: add `exception_agent`.
2. Modal: `cd D:\USPIZZA\Exception` → `modal deploy modal_app.py` (adds the `expect` endpoint).
3. GitHub: new repo for this folder, push; Cloudflare → Workers → Create → import the repo (like the GRN Chaser).
   Worker name `us-pizza-exception`.
4. Worker → Settings → Variables and Secrets (type Secret): `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_KEY` (same as the
   other modules), `EXCEPTION_API_KEY` (same value as the Modal secret `exception-api-key`).
5. Push the hub repo (service binding `EXCEPTION`, `/exception` route, card, HOD signal).

Tests: `npm test`. Thresholds: `worker/rules.js` (FLAG_BELOW = 0.5, MIN_EXPECTED = RM300, …).
