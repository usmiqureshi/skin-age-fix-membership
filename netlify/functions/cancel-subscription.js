// Lets an authenticated member cancel their own subscription at period end.
// Netlify validates the Identity JWT passed in the Authorization header and
// exposes the decoded user on context.clientContext.user — we trust the email
// from there rather than the request body, so a member can only cancel their
// own plan.
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const JSON_HEADERS = { 'Content-Type': 'application/json' };

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const user = context.clientContext && context.clientContext.user;
  if (!user || !user.email) {
    return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    if (!customers.data.length) {
      return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: 'No Stripe customer found' }) };
    }

    const subs = await stripe.subscriptions.list({
      customer: customers.data[0].id,
      status: 'active',
      limit: 1
    });
    if (!subs.data.length) {
      return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: 'No active subscription found' }) };
    }

    const updated = await stripe.subscriptions.update(subs.data[0].id, {
      cancel_at_period_end: true
    });

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        cancelled: true,
        current_period_end: updated.current_period_end
      })
    };
  } catch (err) {
    console.error('cancel-subscription error:', err.message);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not cancel subscription' }) };
  }
};
