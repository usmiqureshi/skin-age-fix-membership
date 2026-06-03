# Skin Age Fix Membership Portal

A doctor-led clinical skincare membership portal for **Luxe Skin Concierge**
(founded by Dr Usman Qureshi). Members pay **£9/month** via Stripe for access to
ten clinical benefits, including the **Dr Q AI Skin Concierge**.

Built as a vanilla static site (no build step / no framework) plus a handful of
Netlify Functions. Hosting: Netlify. Auth: Netlify Identity. Payments: Stripe.
AI: Anthropic API (proxied server-side).

## Structure

```
/
├── index.html                 Public landing — join (£9/mo) + member sign-in
├── netlify.toml                Build config + redirects (role-gated /members/*)
├── _headers                    Security + members noindex/no-store headers
├── _redirects                  /api/* alias + members role gate
├── package.json                Declares the `stripe` dependency for functions
├── assets/
│   ├── css/style.css           Shared brand design system
│   └── js/members.js           Shared member auth gate + authedFetch helper
├── members/                    Protected pages (require active-member role)
│   ├── index.html              Dashboard (10 benefits + cancel)
│   ├── drq.html                01 · Dr Q AI Skin Concierge
│   ├── newsletter.html         02 · Skin Intelligence Newsletter (52 weeks)
│   ├── reassessment.html       03 · Quarterly Skin Age Reassessment quiz
│   ├── dupe.html               04 · Monthly Dupe Destroyer (12 months)
│   ├── product.html            05 · Discounted Product of the Month
│   ├── protocol.html           06 · Monthly Protocol Update (12 months)
│   ├── report.html             07 · Quarterly Skin Intelligence Report (printable)
│   ├── community.html          08 · Inner Circle WhatsApp community
│   ├── mythbuster.html         09 · Fortnightly Myth Buster (26 editions)
│   └── diary.html              10 · Daily Skin Diary (localStorage + trends)
└── netlify/functions/
    ├── create-checkout.js      Creates the Stripe £9/mo checkout session
    ├── stripe-webhook.js       Syncs the active-member role from Stripe events
    ├── cancel-subscription.js  Member self-cancel at period end (JWT verified)
    └── proxy-anthropic.js      Server-side Anthropic proxy for Dr Q (role-gated)
```

## Environment variables (Netlify → Site settings → Environment variables)

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_PRICE_ID=price_...          # the £9/month price ID
STRIPE_WEBHOOK_SECRET=whsec_...
ANTHROPIC_API_KEY=sk-ant-...
SITE_URL=https://luxeskin.co.uk
# Optional:
# ANTHROPIC_MODEL=...              # override the Dr Q model
# NETLIFY_TOKEN / NETLIFY_IDENTITY_URL  # only needed if not using the
#                                  # Identity admin context provided to functions
```

## Deploy

1. Create a GitHub repo and push this code.
2. Netlify → New site → Import from GitHub → select the repo.
3. Netlify → Identity → **Enable Identity**; set Registration to **Invite only**;
   disable external providers (email only).
4. Add the environment variables above.
5. Stripe → create a webhook to
   `https://<your-site>/.netlify/functions/stripe-webhook` listening for
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.deleted`, `customer.subscription.paused`,
   `invoice.payment_failed`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
6. Stripe → create the product **Skin Age Fix Membership** at £9/month and copy
   the price ID into `STRIPE_PRICE_ID`.
7. Deploy.

## How auth works

- A visitor enters their email and is sent to Stripe Checkout.
- On payment, `stripe-webhook.js` creates (or finds) their Netlify Identity user
  and assigns the `active-member` role. GoTrue emails them a password-set link.
- Logging in grants access to `/members/*`; the role is enforced at the edge
  (`netlify.toml` / `_redirects`) and again client-side in `assets/js/members.js`.
- Cancelling sets the Stripe subscription to cancel at period end; the
  `customer.subscription.deleted` / `paused` / `invoice.payment_failed` events
  remove the role and revoke access.

## Monthly tasks for Dr Usman

- Update the GetHarley link in `members/product.html` each month.
- Replace the placeholder WhatsApp invite link in `members/community.html`.
- New members and access control are fully automated via Stripe + Netlify.

> Educational guidance only — not a substitute for medical advice.
