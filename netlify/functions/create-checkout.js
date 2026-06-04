// Creates a Stripe Checkout session for the £9/month Skin Age Fix Membership.
// On success Stripe sends the customer to /members/, on cancel back to the
// landing page. The checkout's metadata + customer_email let the webhook tie
// the resulting subscription back to a Netlify Identity account.
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const JSON_HEADERS = { 'Content-Type': 'application/json' };

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let email, firstName, lastName;
  try {
    ({ email, firstName, lastName } = JSON.parse(event.body || '{}'));
  } catch (e) {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'A valid email is required' }) };
  }

  firstName = (firstName || '').trim().slice(0, 60);
  lastName = (lastName || '').trim().slice(0, 60);
  if (!firstName || !lastName) {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'First and last name are required' }) };
  }
  const fullName = `${firstName} ${lastName}`;

  const siteUrl = process.env.SITE_URL || `https://${event.headers.host}`;

  // Carry the member's details through Stripe so the webhook can create their
  // Netlify Identity profile with the correct name.
  const memberMeta = {
    netlify_email: email,
    netlify_first_name: firstName,
    netlify_last_name: lastName,
    netlify_full_name: fullName
  };

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${siteUrl}/members/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/?cancelled=true`,
      subscription_data: { metadata: memberMeta },
      metadata: memberMeta
    });

    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    console.error('create-checkout error:', err.message);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not start checkout' }) };
  }
};
