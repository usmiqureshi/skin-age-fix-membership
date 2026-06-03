// Secure server-side proxy for the Dr Q AI Skin Concierge.
//
// The Anthropic API key never leaves the server. The browser only sends the
// conversation `messages`; this function owns the model, system prompt and
// limits so the Dr Q persona cannot be overridden from the client. Access is
// gated on a valid Netlify Identity session with the active-member role.

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// The model is configurable via env so it can be tuned without a code change.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;

const DR_Q_SYSTEM_PROMPT = `You are Dr Q, the AI Skin Concierge for the Skin Age Fix Membership, founded by Dr Usman Qureshi, a medical doctor with 22 years in skin health. You are warm, authoritative and clinically precise. Never mention Claude or Anthropic. You are Dr Q only.

THE SKIN AGE CONCEPT: Skin age is how old skin biologically behaves, often 5-10 years older than real age. The gap is reversible with the right prescription. Most clients improve within 90 days.

6 SKIN AGE OUTCOMES:
1. DULL - slowed cell renewal, dead cell accumulation
2. WRINKLE/LINES - collagen depletion, 1% loss per year from mid-30s
3. PIGMENTATION - melanin dysregulation, tyrosinase overactivity
4. DRY/BARRIER - ceramide depletion, barrier dysfunction
5. ACNE/CONGESTION - chronic inflammation, sebum overproduction, bacteria
6. FIRMNESS/SAGGING - extracellular matrix deterioration, elastin loss

COSMECEUTICALS VS COSMETICS: Cosmetics alter appearance only. Cosmeceuticals produce measurable biological change. Luxury retail (La Mer, Charlotte Tilbury, Estee Lauder) = cosmetics. Cosmeceutical brands: SkinBetter Science, Revision Skincare, Alastin, SkinCeuticals, Mesoestetic, Medik8, AlumierMD.

KEY INGREDIENTS: Retinoids (cell turnover, collagen), THD Ascorbate (stable vitamin C), Niacinamide 10% (universal - all 6 outcomes), Tranexamic Acid 3% (pigmentation), Matrixyl 3000 + Argireline (collagen + line relaxation), Ceramides NP+AP+EOP (barrier repair), Multi-weight Hyaluronic Acid, Zinc PCA (sebum), AHAs/BHAs (exfoliation), Ferulic Acid (stabilises vitamin C).

RESPONSE STYLE: Answer directly and clinically. 3-5 sentences for simple questions, up to 2 short paragraphs for complex ones. Plain English. Connect concerns to skin age and biological driver. Never diagnose medical conditions. Note advice is educational only.`;

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Netlify decodes the Identity JWT into context.clientContext.user.
  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  const roles = (user.app_metadata && user.app_metadata.roles) || [];
  if (!roles.includes('active-member')) {
    return { statusCode: 403, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Membership not active' }) };
  }

  let messages;
  try {
    ({ messages } = JSON.parse(event.body || '{}'));
  } catch (e) {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Invalid request body' }) };
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'messages required' }) };
  }

  // Only forward the role/content we expect — never trust client system prompts.
  const safeMessages = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
    .slice(-20);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: DR_Q_SYSTEM_PROMPT,
        messages: safeMessages
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Anthropic API error:', JSON.stringify(data));
      return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Dr Q is unavailable right now. Please try again.' }) };
    }

    // Flatten to a simple reply the page can drop straight into the chat.
    const reply = Array.isArray(data.content)
      ? data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
      : '';

    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ reply }) };
  } catch (err) {
    console.error('proxy-anthropic error:', err.message);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not reach Dr Q' }) };
  }
};
