# Deal Radar

A personal phone app for San Antonio food deals: fast-food app offers, promo codes, free-food giveaways,
and the food perks on Amex Gold, Amex Platinum, Capital One and Citi cards. It shows a month calendar and
a weekly schedule, and it sends reminders you control per category, restaurant, and deal. When you run
**Search deals** on your PC, Claude (through your Claude plan) re-checks every deal, drops dead ones, searches
for new deals and promo codes, and uploads the new list once you approve it.

## What's in the app

| Tab | What it shows |
| --- | --- |
| **Today** | Deals ending soon, card credits about to reset, what's on today, the next 7 days, new finds, and always-on sign-up and birthday perks. Pull down to check for new deals. |
| **Calendar** | A month grid with colored dots per deal category and 💳 on days card credits reset. Tap a day to see its deals. |
| **Weekly** | Standing weekly specials (Taco Tuesday and so on), starting with today. |
| **Cards** | Each card's food earn rates, monthly, quarterly and yearly credits with a "used" switch, and card-linked offers. **Add an offer** saves a targeted offer from your Amex, Capital One or Citi app so you get expiry reminders. |
| **Alerts** | Reminder timing, category switches, a per-restaurant mute list, your per-deal choices, the data source, and a list of every reminder queued on the phone. |

Each deal page has **Default / Always / Never** for that deal's notifications, a copy button for promo codes,
the source link, and a **Hide** button.

### How reminders work

Reminders are local notifications that the app schedules on the phone, so no server or account is involved.
For each deal you allow, the app queues:

- **Morning reminder** (default 9 AM) on days a deal runs. Three or more on the same day are grouped into one digest.
- **Heads-up** 15 minutes before timed drops, such as a 1 PM app drop.
- **Ending soon** the day before a promo ends, plus **last day**.
- **Card credits**: 3 days before a monthly, quarterly, half-year or yearly credit resets, and on the last
  day, unless you marked it used.
- **Sunday 6 PM** preview of the week, and a **Monday 10 AM** reminder to run your weekly deal search.

**Weekly specials don't send reminders by default.** That covers kids-eat-free nights, happy hours, and
Taco Tuesday. There are dozens, so they stay on the Weekly tab and in the Sunday preview. To get reminders
for one, open it and choose **Always**. To get reminders for all of them, turn on **Remind me about every
weekly special** in Alerts. Always-on perks, such as sign-up and birthday rewards, never send reminders.

All of these can be changed in **Alerts**. iPhones hold at most 64 pending reminders per app, so the app keeps
the next 60 and rebuilds the list whenever you open it. With the defaults that's about one ping a day, plus
heads-ups for one-time timed events.

## Run it on your phone

You need Node 22+ on your computer. Install once:

```bash
npm install
```

### Fastest: Expo Go (free, iPhone or Android)

1. Install **Expo Go** from the App Store or Play Store.
2. On the computer, run `npx expo start` and scan the QR code. Use the iPhone Camera app on iOS, or Expo Go on Android.
3. Allow notifications when asked.

Reminders stay scheduled on the phone after you close the app. To open the app again later, the computer must be
running `npx expo start`, on the same Wi-Fi network. Or use `npx expo start --tunnel` to connect from anywhere.

### Permanent install

- **Android (free):** build an APK in the cloud and install it directly.

  ```bash
  npx eas-cli@latest build --platform android --profile preview
  ```

  Open the link EAS gives you on your phone and install the APK. You need a free Expo account.
- **iPhone:** a standalone install needs a paid Apple Developer membership ($99/year). Register your phone with
  `npx eas-cli@latest device:create`, then run `npx eas-cli@latest build --platform ios --profile preview`.

## Searching for deals

`scripts/update-deals.ts` keeps the deal list fresh. Each run can do two things:

**Deal check**

1. **Verify.** It re-checks active deals and keeps, corrects or removes each one. The least recently checked
   deals go first.
2. **Discover.** It searches seven angles: San Antonio local news and giveaways, national app deals, weekly
   specials, upcoming food holidays, card-linked offers, San Antonio chains and sports promos, and loyalty
   sign-up and birthday perks.
3. **Double-check.** A skeptic pass tries to disprove each new find before it's kept.
4. **Card benefits.** It re-checks the card benefits and earn rates.

**Promo codes**

It searches for current promo codes at every restaurant in `data/code-watchlist.json`, and at any
restaurant with two or more deals in the list. It covers each brand's app and website codes, delivery-app
codes, rewards codes, and new-customer codes. A code is kept only if the brand announced it, or a
reputable deal site, Slickdeals or Reddit reported it working in the last ~45 days. Coupon-aggregator
sites alone don't count, because they list stale and fake codes. A skeptic pass checks every code. To
change which restaurants get searched, edit `code-watchlist.json`.

The result is written to `data/deals.json`, with a summary of every change in `data/last-run.json`. The app
downloads `data/deals.json` from GitHub when you open it, if its copy is more than 6 hours old, or when you
pull down on Today. In the app, the **Promo codes** filter on Today and Weekly shows every deal with a code.
Tap a code to copy it.

### Run it yourself with your Claude plan

This uses Claude Code on your PC, signed in with your Claude subscription, so there's no API bill. Runs
count against your plan's usage limits; if you hit one, the run stops early and keeps what it found.

**One-time setup**

1. Install [Git](https://git-scm.com/download/win) and [Node.js](https://nodejs.org) 22 or newer if you don't have them.
   Tell Git who you are, once:

   ```powershell
   git config --global user.name "Your Name"
   ```

   ```powershell
   git config --global user.email "you@example.com"
   ```

2. Install Claude Code if it isn't installed yet. The script also finds it in `%USERPROFILE%\.local\bin`
   when that folder isn't on your PATH.

   ```powershell
   irm https://claude.ai/install.ps1 | iex
   ```

3. Run `claude` once and sign in with your Claude account. `claude auth status` should then show a
   `claude.ai` login. The search refuses to run when Claude Code would bill anything else, such as an API
   key, an `apiKeyHelper` or a cloud provider, so you're never billed by surprise.
4. Get a permanent copy of this repo, for example:

   ```powershell
   gh repo clone electricrecall7/deal-radar C:\dev\deal-radar
   ```

**Each time**

Double-click **`Search deals.cmd`** in the repo folder, or run `npm run search`. It:

1. Pulls the latest list from GitHub.
2. Asks what to search for:
   - **Deals:** about 1–2 hours.
   - **Promo codes:** about 30–60 minutes.
   - **Both.**
   - **Preview only:** shows what a search would do, without searching.
3. Runs the search with your plan.
4. Checks the new list.
5. Shows what changed.
6. Asks **"Upload these results to the app now?"** Only a yes commits and pushes `data/deals.json`. Then
   pull down on Today in the app to load it.

If you say no, the results stay in `data/`. Run the script again and choose **Upload the results kept
from the last search**, or throw them away with `git checkout -- data/deals.json data/last-run.json`. If a
search fails, the data files are put back exactly as they were. The upload commits only those two files, and
never on top of a newer list: if GitHub changed while you searched, it tells you instead of merging.

You can run the same thing directly:

```bash
npx tsx scripts/update-deals.ts --engine=claude-code --skip-codes
```

```bash
npx tsx scripts/update-deals.ts --engine=claude-code --only-codes
```

Set `DEAL_MODEL` (for example `opus` or `sonnet`) to pick a model your plan includes; by default it uses your
plan's default model.

The Alerts tab has a **Monday reminder to run the deal search**, so you don't forget.

### On GitHub with an API key (optional)

`.github/workflows/weekly-deals.yml` runs the same search on GitHub, billed to an API key. It no longer runs on
a schedule; start it from the **Actions** tab (**Deal search (API)** → **Run workflow**) and pick `deals`,
`codes` or `dry-run`. It needs a repository secret `ANTHROPIC_API_KEY` from <https://platform.claude.com>.

It uses `claude-opus-5-5` by default. The first deal check made 34 requests and 234 web searches.
From its token counts, it cost about $16.60. A promo-code run adds roughly $5–8.

To spend less:

- Set the repository variable `DEAL_MODEL` to `claude-sonnet-5-5`.
- Set `DEAL_EFFORT` to `medium`.
- Trim `data/code-watchlist.json`.

To bring the automatic Monday/Thursday runs back, see the comment at the top of the workflow file.

Preview a run without searching or spending anything:

```bash
npm run update-deals -- --dry-run
```

## Development

```bash
npx expo start          # dev server (press w for a browser preview)
npm run typecheck       # TypeScript
npm test                # unit tests (node:test)
```

- `src/lib/` holds pure logic: the schema, dates, recurrence rules, the reminder planner and formatting. It's shared
  with the updater script and unit-tested.
- `src/state/` holds app state, persistence and the download and reschedule engine.
- `src/app/` holds the screens (expo-router).
- `data/deals.json` is the deal list. The copy bundled in the app is used until the first download succeeds.

### Deal format

```jsonc
{
  "id": "taco-bell-1-celebrity-meal-tue",
  "restaurant": "Taco Bell",
  "title": "$1 celebrity meal drop",
  "category": "app",          // freebie | app | deal | card | delivery
  "channel": "app",           // app | in-store | online | drive-thru | delivery | card | any
  "start": "2026-10-20",      // first valid day (San Antonio date)
  "end": "2026-11-02",        // last valid day, inclusive; omit if ongoing
  "days": [2],                // weekdays, 0 = Sunday; omit if every day
  "startTime": "13:00",       // 24h local time, optional
  "status": "confirmed",      // confirmed = brand source or two 2026 sources
  "sourceUrl": "https://..."
}
```
