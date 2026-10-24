# Deal Radar

A personal phone app for San Antonio food deals: fast-food app offers, promo codes, free-food giveaways,
and the food perks on Amex Gold, Amex Platinum, Capital One and Citi cards. It shows a month calendar and
a weekly schedule, and it sends reminders you control per category, restaurant, and deal. Once a week a
GitHub Action has Claude re-check every deal, drop dead ones, and search for new ones.

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
- **Sunday 6 PM** preview of the week, and a **Monday 10 AM** "this week's deals are in" nudge.

**Weekly specials don't send reminders by default.** That covers kids-eat-free nights, happy hours, and
Taco Tuesday. There are dozens, so they stay on the Weekly tab and in the Sunday preview. To get reminders
for one, open it and choose **Always**. To get reminders for all of them, turn on **Remind me about every
weekly special** in Alerts. Always-on perks, such as sign-up and birthday rewards, never send reminders.

All of these can be changed in **Alerts**. iPhones hold at most 64 pending reminders per app, so the app keeps
the next 60 and rebuilds the list whenever you open it. With the defaults that's about one ping a day, plus
heads-ups for one-time timed events.

## Run it on your phone

You need Node 20+ on your computer. Install once:

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

## The weekly deal search

`scripts/update-deals.ts` uses the Claude API with web search and web fetch. The GitHub Action runs it twice
a week, and each run has its own time budget.

**Monday, 5 AM Central: deal check**

1. **Verify.** It re-checks active deals and keeps, corrects or removes each one. The least recently checked
   deals go first.
2. **Discover.** It searches seven angles: San Antonio local news and giveaways, national app deals, weekly
   specials, upcoming food holidays, card-linked offers, San Antonio chains and sports promos, and loyalty
   sign-up and birthday perks.
3. **Double-check.** A skeptic pass tries to disprove each new find before it's kept.
4. **Card benefits.** It re-checks the card benefits and earn rates.

**Thursday, 5 AM Central: promo codes**

It searches for current promo codes at every restaurant in `data/code-watchlist.json`, and at any
restaurant with two or more deals in the list. It covers each brand's app and website codes, delivery-app
codes, rewards codes, and new-customer codes. A code is kept only if the brand announced it, or a
reputable deal site, Slickdeals or Reddit reported it working in the last ~45 days. Coupon-aggregator
sites alone don't count, because they list stale and fake codes. A skeptic pass checks every code. To
change which restaurants get searched, edit `code-watchlist.json`.

The result is written to `data/deals.json`, with a summary in `data/last-run.json`. The app downloads
`data/deals.json` from GitHub each time you open it, if the copy it has is more than 6 hours old. In the app,
the **Promo codes** filter on Today and Weekly shows every deal with a code. Tap a code to copy it.

### Set it up

1. Push this folder to a **public** GitHub repo named `deal-radar`. The app reads
   `https://raw.githubusercontent.com/<you>/deal-radar/main/data/deals.json`, and you can change that URL in
   **Alerts → Data**. The file holds only public deal info. Your settings, used credits and hand-entered card
   offers stay on your phone.
2. Get an API key at <https://platform.claude.com> and add it as a repository secret named
   `ANTHROPIC_API_KEY` under Settings → Secrets and variables → Actions.
3. The workflow (`.github/workflows/weekly-deals.yml`) runs Mondays and Thursdays at 5 AM Central. To run it now,
   open the **Actions** tab, pick **Weekly deal search**, choose **Run workflow**, and pick `deals`, `codes`
   or `dry-run`.

### Cost

It uses `claude-opus-5-5` by default.

- The Monday run makes up to ~35 requests and ~250 web searches.
- The Thursday code run makes ~15 requests and ~125 searches.

Web search is billed at $10 per 1,000 searches, so that's about $3.75 a week in search fees. Tokens come on
top. **Expect very roughly $10–20 a week in total.** This is an estimate, not a measurement. After the first
runs, check `data/last-run.json` for real token and search counts. To spend less, you can:

- Set the repository variable `DEAL_MODEL` to `claude-sonnet-5-5`, which costs about half as much per token.
- Set `DEAL_EFFORT` to `medium`.
- Trim `data/code-watchlist.json`.

New API accounts have low rate limits. The first runs may defer some verification to the next week; the
summary in `data/last-run.json` lists what was deferred.

Try it locally without spending anything:

```bash
npm run update-deals -- --dry-run
```

```bash
npm run update-deals -- --dry-run --only-codes
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
