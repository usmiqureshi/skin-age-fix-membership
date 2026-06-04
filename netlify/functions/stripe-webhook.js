// Stripe webhook -> Netlify Identity role sync.
//
// Active subscription  => user gets the `active-member` role (created if new).
// Cancelled / paused / failed payment => the role is removed.
//
// Subscribe Stripe to: checkout.session.completed, customer.subscription.created,
// customer.subscription.deleted, customer.subscription.paused,
// invoice.payment_failed. The webhook secret is verified on every call.
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const MEMBER_ROLE = 'active-member';

// --- Netlify Identity admin helpers -----------------------------------------
// Inside a Netlify Function the Identity instance + an admin token are provided
// on context.clientContext.identity. We fall back to explicit env vars
// (NETLIFY_IDENTITY_URL / NETLIFY_TOKEN) for local testing.
function identityConfig(context) {
  const ctx = context && context.clientContext && context.clientContext.identity;
  const url = (ctx && ctx.url) || process.env.NETLIFY_IDENTITY_URL;
  const token = (ctx && ctx.token) || process.env.NETLIFY_TOKEN;
  return { url, token };
}

async function identityFetch({ url, token }, path, options = {}) {
  const res = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Identity ${path} -> ${res.status}: ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

async function findUserByEmail(cfg, email) {
  const target = email.toLowerCase();
  // GoTrue paginates; walk pages until we find a match or run out.
  for (let page = 1; page <= 20; page++) {
    const data = await identityFetch(cfg, `/admin/users?per_page=100&page=${page}`);
    const users = (data && data.users) || [];
    const match = users.find((u) => (u.email || '').toLowerCase() === target);
    if (match) return match;
    if (users.length < 100) break;
  }
  return null;
}

// Ensure the user exists and carries (or loses) the active-member role.
// `profile.fullName` (optional) is stored so the members area can greet the
// member by name. `allowCreate` gates account creation to a single event type
// so concurrent Stripe events can't create duplicate accounts.
async function setMembership(cfg, email, active, profile = {}, allowCreate = false) {
  let user = await findUserByEmail(cfg, email);

  if (!user) {
    if (!active || !allowCreate) return; // only the designated event creates
    // Invite-only onboarding: the invite endpoint creates the account AND emails
    // the member a "set your password" link (the canonical Netlify Identity
    // flow). We then assign the role + name below.
    let invited = null;
    try {
      invited = await identityFetch(cfg, '/invite', {
        method: 'POST',
        body: JSON.stringify({ email })
      });
    } catch (e) {
      // A concurrent event (or a Stripe retry) may have already created the
      // account — re-check before assuming a real failure.
      console.error('invite error, re-checking for existing user:', e.message);
      invited = await findUserByEmail(cfg, email);
      if (!invited) {
        // Genuine failure: create directly so access still works, then email a
        // password-set (recovery) link.
        try {
          invited = await identityFetch(cfg, '/admin/users', {
            method: 'POST',
            body: JSON.stringify({ email, confirm: true, app_metadata: { roles: [MEMBER_ROLE] } })
          });
          try {
            await fetch(`${cfg.url}/recover`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email })
            });
          } catch (re) { console.error('recover email failed:', re.message); }
        } catch (ce) {
          // Created in parallel between our checks — fall through to lookup.
          console.error('admin create error, re-checking:', ce.message);
          invited = await findUserByEmail(cfg, email);
        }
      }
    }
    user = invited && invited.id ? invited : await findUserByEmail(cfg, email);
    if (!user) return; // role will be applied on a subsequent event
  }

  const roles = new Set((user.app_metadata && user.app_metadata.roles) || []);
  if (active) roles.add(MEMBER_ROLE);
  else roles.delete(MEMBER_ROLE);

  const userMeta = Object.assign({}, user.user_metadata);
  if (profile.fullName && !userMeta.full_name) userMeta.full_name = profile.fullName;

  await identityFetch(cfg, `/admin/users/${user.id}`, {
    method: 'PUT',
    body: JSON.stringify({ app_metadata: { roles: [...roles] }, user_metadata: userMeta })
  });
}

// Resolve the member's email from whichever Stripe object the event carries.
async function emailFromObject(obj) {
  if (!obj) return null;
  if (obj.customer_email) return obj.customer_email;
  if (obj.customer_details && obj.customer_details.email) return obj.customer_details.email;
  if (obj.metadata && obj.metadata.netlify_email) return obj.metadata.netlify_email;
  if (obj.customer) {
    try {
      const customer = await stripe.customers.retrieve(obj.customer);
      if (customer && !customer.deleted) return customer.email;
    } catch (e) {
      console.error('customer lookup failed:', e.message);
    }
  }
  return null;
}

// Resolve the member's display name from the metadata we set at checkout.
function nameFromObject(obj) {
  const m = (obj && obj.metadata) || {};
  if (m.netlify_full_name) return m.netlify_full_name.trim();
  const composed = [m.netlify_first_name, m.netlify_last_name].filter(Boolean).join(' ').trim();
  if (composed) return composed;
  if (obj && obj.customer_details && obj.customer_details.name) return obj.customer_details.name;
  return '';
}

exports.handler = async (event, context) => {
  const cfg = identityConfig(context);
  if (!cfg.url || !cfg.token) {
    console.error('Netlify Identity admin credentials unavailable');
    return { statusCode: 500, body: 'Identity not configured' };
  }

  // Verify the signature against the raw body.
  let stripeEvent;
  try {
    const sig = event.headers['stripe-signature'];
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    stripeEvent = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  try {
    const obj = stripeEvent.data.object;

    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        // The single source of truth for onboarding a new member.
        const email = await emailFromObject(obj);
        if (email) await setMembership(cfg, email, true, { fullName: nameFromObject(obj) }, true);
        break;
      }
      case 'customer.subscription.created': {
        // Reinforces the role on an existing member; never creates an account
        // (checkout.session.completed owns creation) to avoid duplicates.
        const email = await emailFromObject(obj);
        if (email) await setMembership(cfg, email, true, { fullName: nameFromObject(obj) }, false);
        break;
      }
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'invoice.payment_failed': {
        const email = await emailFromObject(obj);
        if (email) await setMembership(cfg, email, false);
        break;
      }
      default:
        // Unhandled event types are acknowledged so Stripe stops retrying.
        break;
    }
  } catch (err) {
    console.error('Webhook processing error:', err.message);
    return { statusCode: 500, body: 'Webhook handler failed' };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
