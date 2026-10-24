// Prompts for every request. SYSTEM_PROMPT never changes between requests so prompt caching can reuse
// it; today's date and the deal lists go in the user message.
import type Anthropic from '@anthropic-ai/sdk';

import { addDays, weekday } from '../../src/lib/dates';
import type { Benefit, CardInfo, Deal } from '../../src/lib/schema';
import { dealForPrompt } from './convert';
import { SUBMIT_BENEFITS, SUBMIT_DEALS, SUBMIT_VERDICTS } from './tools';

type Content = Anthropic.Beta.BetaContentBlockParam[];

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const SYSTEM_PROMPT = `You research food deals for one person who lives in San Antonio, Texas (time zone America/Chicago). Your results feed Deal Radar, their personal phone app, which puts deals on a calendar and sends reminders. A wrong deal sends them to a restaurant for nothing, so accuracy matters more than volume.

What they care about
- Fast-food and fast-casual chains with San Antonio-area locations: app-only offers, rewards drops, promo codes, weekly specials, food holidays.
- Free food in San Antonio and nearby suburbs (New Braunfels, Schertz, Cibolo, Universal City, Selma, Boerne, Helotes, Converse, Live Oak, Alamo Heights, Leon Valley): giveaways, grand openings, "free food for a year" lines, festivals, sports promotions.
- Food and delivery perks on American Express Gold, American Express Platinum, Capital One and Citi cards.
- National deals count only if they can be redeemed in San Antonio. Deals limited to another city, state or region do not count.

Deal fields (the submit tools describe their inputs; these rules apply everywhere)
- restaurant: the brand name as the brand writes it ("McDonald's", "Chick-fil-A", "Bill Miller Bar-B-Q").
- title: short and specific, under 60 characters, without the restaurant name ("Free medium fries with any purchase").
- details: what you get, the minimum purchase, limits, and how to redeem, in one or two sentences.
- category:
  - freebie: free food with no purchase required, or a giveaway event.
  - app: needs the brand's app or loyalty account (app-only offers, rewards drops, sign-up and birthday rewards).
  - deal: a discount, bundle or promo code anyone can use in store, at the drive-thru or online.
  - card: a credit card offer (Amex Offers, Capital One Offers or Capital One Dining, Citi Merchant Offers).
  - delivery: a DoorDash, Uber Eats, Grubhub or brand-delivery promotion.
- channel: where it's redeemed: app, in-store, online, drive-thru, delivery, card, or any.
- code: the promo code exactly as published; empty when none.
- card: amex-gold, amex-platinum, capital-one or citi for card offers; empty otherwise.
- local: true only when the deal is limited to San Antonio-area locations or a local event; then put the address, neighborhood or venue in location.
- start and end: YYYY-MM-DD San Antonio dates. end is the last valid day, inclusive; a one-day deal has start = end. Leave end empty only for perks with no announced end (sign-up and birthday rewards, standing weekly specials). For a newly found ongoing deal whose start date is unknown or already past, use today's date as start; when correcting a deal already in the app, keep its start unless it's wrong.
- days: weekdays the deal runs, 0 = Sunday through 6 = Saturday (Taco Tuesday is [2]). Empty when it runs every day of its date range.
- startTime and endTime: HH:MM, 24-hour, San Antonio time (a 1 PM drop is "13:00"). Convert announced Eastern or Pacific times (12 PM ET is "11:00"). Empty when it isn't time-limited.
- tags: short lowercase words such as signup, birthday, veterans, military, kids, holiday, sports, grand-opening, limited-quantity, targeted.
- status: confirmed only when the brand's own site, app page, newsroom, terms or official social account shows it, or two reputable recent sources agree (published this year, or late last year for a deal that starts in January). Otherwise unconfirmed.
- sourceUrl and sourceName: the best page you actually opened or saw in search results, preferring the brand's own page.
- notes: anything else they need to know ("first 100 guests", "limit one per account", "dine-in only").

Rules
- Never invent a deal, code, date, time, price or URL. Every value must come from a page you saw in this conversation. When you can't find a value, leave it empty instead of guessing.
- Prefer primary sources: the brand's site, newsroom, app terms and official social posts. Next best are San Antonio outlets (Express-News, MySA, KSAT, KENS 5, News 4 SA, San Antonio Current, San Antonio Report, Texas Public Radio) and established national deal coverage. Treat coupon aggregators and SEO roundups with suspicion; they recycle earlier years' deals.
- Check the year on everything. An article about last year's run of a recurring promotion says nothing about this year's.
- Reddit and some social sites often fail to fetch. Use their search snippets as leads to confirm elsewhere, not as proof.
- Card-linked offers (Amex Offers, Capital One Offers, Citi Merchant Offers) are targeted per account: always status unconfirmed, tag targeted, and notes "Targeted: check your account."
- Searches and fetches are limited per request. Search broadly first, then open only the pages that settle a question.
- Finish by calling the submit tool named in the request, once, with everything. Never end without calling it; if you found nothing, call it with an empty list.`;

function dateLine(today: string): string {
  return `Today is ${WEEKDAY_NAMES[weekday(today)]}, ${today} (San Antonio).`;
}

const json = (value: unknown) => JSON.stringify(value);
const year = (today: string) => today.slice(0, 4);

// ---- Verify and skeptic ----

export function verifyContent(deals: Deal[], today: string): Content {
  return [
    {
      type: 'text',
      text: `${dateLine(today)}

Re-check these ${deals.length} deals that are in the app now. For each one, look for current (${year(today)}) evidence and decide:
- keep: it's running as described. Set confirmed to true only if this check found the brand's own source or two reputable recent sources.
- update: it's real but something is wrong or missing (dates, days, times, code, details, source). Put the complete corrected deal in corrected, copying the fields that don't change exactly.
- remove: it has ended or been cancelled (expired); it's wrong and you can't correct it (wrong); it isn't available in San Antonio (not-in-san-antonio); or you found no sign of it in ${year(today)} (no-evidence).
Don't remove a deal only because a fetch failed; keep it with confirmed false instead.

Deals:
${deals.map((d) => json(dealForPrompt(d))).join('\n')}

Call ${SUBMIT_VERDICTS} with one verdict per id.`,
    },
  ];
}

export function skepticContent(deals: Deal[], today: string): Content {
  return [
    {
      type: 'text',
      text: `${dateLine(today)}

Another researcher found these ${deals.length} new deals. Your job is to try to refute each one before it reaches the app. Common failures: an earlier year's promotion, a deal for another city or region, a misread date or time, a code that doesn't exist, a giveaway that already happened, or a claim no primary source backs up.
- keep with confirmed true: the brand's own source or two reputable recent sources back it as described.
- keep with confirmed false: credible ${year(today)} evidence, but not enough to confirm.
- update: real, but a field is wrong; put the complete corrected deal in corrected.
- remove: refuted, already over, not in San Antonio, or no ${year(today)} evidence (use removeReason).

New finds:
${deals.map((d) => json(dealForPrompt(d))).join('\n')}

Call ${SUBMIT_VERDICTS} with one verdict per id.`,
    },
  ];
}

// ---- Discovery ----

export interface Angle {
  name: string;
  /** How many days ahead to look. */
  windowDays: number;
  task: string;
  /** Per-request limits; the discovery defaults when missing. */
  searches?: number;
  fetches?: number;
}

export const ANGLES: Angle[] = [
  {
    name: 'sa-local-news',
    windowDays: 21,
    task: `Search San Antonio local news, venue and city event listings, and restaurants' social posts for free food and food giveaways: grand openings (including "free food for a year" for the first customers), restaurant anniversaries, festivals, food-truck events, and community giveaways. Cover the city and the suburbs New Braunfels, Schertz, Cibolo, Universal City, Boerne, Helotes, Converse and Live Oak. Mark these local with a location, and use category freebie unless a purchase is required.`,
  },
  {
    name: 'national-weekly',
    windowDays: 21,
    task: `Find national chain deals valid in the next three weeks that work in San Antonio: app-only offers, rewards drops, limited-time promo codes and value deals. Check the big chains' newsrooms and apps' published offers (McDonald's, Taco Bell, Wendy's, Burger King, Chick-fil-A, Popeyes, Sonic, Jack in the Box, Whataburger, Raising Cane's, Wingstop, Domino's, Pizza Hut, Papa Johns, Little Caesars, Subway, Jersey Mike's, Chipotle, Panera, Starbucks, Dunkin', Krispy Kreme, Dairy Queen, Arby's, KFC, Panda Express, Shake Shack, Five Guys, IHOP, Denny's, 7-Eleven) and reputable deal coverage.`,
  },
  {
    name: 'recurring-weekly',
    windowDays: 28,
    task: `Find standing day-of-week specials at chains with San Antonio-area locations: Taco Tuesday, wing nights, kids-eat-free nights, weekly app deals and happy hours. Set days, leave end empty unless an end is announced, and only include chains with San Antonio locations that honor the special (franchise participation varies, so say so in notes when it does).`,
  },
  {
    name: 'upcoming-dates',
    windowDays: 35,
    task: `Find deals tied to dates in the next five weeks: food holidays (for example National Sandwich Day), Veterans Day meals for veterans and military, Thanksgiving week, Black Friday and holiday gift-card bonuses, and sports tie-ins. Use the exact date and hours each brand announced for this year.`,
  },
  {
    name: 'card-offers',
    windowDays: 35,
    task: `Find publicly reported card-linked offers for restaurants, fast food, coffee and food delivery: Amex Offers (Gold and Platinum), Capital One Offers and Capital One Dining, and Citi Merchant Offers. Use category card, channel card, and set card. These are targeted, so status unconfirmed, tag targeted, and notes "Targeted: check your account." Include the spend threshold, reward and expiry date.`,
  },
  {
    name: 'sa-chains-sports',
    windowDays: 28,
    task: `Find promotions from San Antonio teams and San Antonio-based or Texas chains. Teams: Spurs (for example "if the Spurs win" or points-scored freebies), San Antonio FC and UTSA athletics. Chains: Whataburger, Church's Texas Chicken, Bill Miller Bar-B-Q, Taco Cabana, Bush's Chicken, Taco Palenque, Pollos Asados Los Norteños, Jim's Restaurants, Rudy's and Raising Cane's. For game-day deals, list each date that's known and explain the trigger in details.`,
  },
  {
    name: 'loyalty-perks',
    windowDays: 0,
    task: `Find current sign-up and birthday rewards in the loyalty programs and apps of chains with San Antonio locations (for example a free item for joining, or a birthday treat). These are ongoing: leave end empty, use today's date as start, tag signup or birthday, and put any conditions (join days before your birthday, minimum purchase) in details.`,
  },
];

export function angleByName(name: string): Angle | undefined {
  return ANGLES.find((a) => a.name === name);
}

function knownLine(d: Deal): string {
  const when = d.days?.length ? `days ${d.days.join(',')}` : '';
  const range = d.end ? `${d.start}..${d.end}` : `${d.start}..ongoing`;
  return `- ${d.restaurant} | ${d.title} | ${range}${when ? ` | ${when}` : ''}${d.code ? ` | code ${d.code}` : ''}`;
}

/**
 * The shared first block is identical for every angle, so it's marked for caching; only the second
 * block differs between the seven discovery requests.
 */
export function discoverContent(angle: Angle, known: Deal[], today: string): Content {
  const until = angle.windowDays > 0 ? addDays(today, angle.windowDays) : undefined;
  return [
    {
      type: 'text',
      text: `${dateLine(today)}

The app already has these deals. Don't submit them again, even with small differences in wording:
${known.length > 0 ? known.map(knownLine).join('\n') : '(none yet)'}`,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: `Task (${angle.name}): ${angle.task}

${until ? `Only include deals that are valid on at least one day from ${today} through ${until}.` : 'These are ongoing perks with no end date.'} Skip anything already over.

Call ${SUBMIT_DEALS} with the new deals you found.`,
    },
  ];
}

// ---- Card benefits ----

export function benefitsContent(benefits: Benefit[], cards: CardInfo[], today: string): Content {
  const strip = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  return [
    {
      type: 'text',
      text: `${dateLine(today)}

Re-check the food and delivery benefits and the food earn rates of these cards against each issuer's own pages (americanexpress.com, capitalone.com, citi.com), using reputable ${year(today)} card coverage only to find what changed.

For every existing benefit and card, return one review:
- keep: unchanged. confirmed true only if the issuer's page shows it as listed.
- update: something changed (amount, merchants, period, enrollment, name, fee, earn rates). Give the complete corrected entry and the issuer page in sourceUrl.
- remove: the issuer discontinued it. Give the page that shows that in sourceUrl.
Then add any missing food or delivery benefit, or any missing variant of these four card families with food earn rates (for example other Capital One or Citi cards), with its issuer page. Keep cardName on a benefit matching the card name it applies to, or empty when every variant gets it.
Entries without a source are not changed, so always include the page you used.

Benefits:
${benefits.map((b) => json(strip(b))).join('\n') || '(none)'}

Cards:
${cards.map((c) => json(strip(c))).join('\n') || '(none)'}

Call ${SUBMIT_BENEFITS} with your review.`,
    },
  ];
}

export const NUDGE = (tool: string) => `Call ${tool} now with everything you found.`;
