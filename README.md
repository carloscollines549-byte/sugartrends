# Sukari Trends KSB Dashboard

## OpenRouter on Netlify

The dashboard sends AI requests to the Netlify Function at `/.netlify/functions/openrouter-chat`. The function reads the OpenRouter key only on the server; never put the key in `index.html`, browser storage, `netlify.toml`, or a committed file.

To enable it:

1. In Netlify, open the Sugartrends site's **Environment variables** settings.
2. Add `OPENROUTER_API_KEY` with the value of an OpenRouter API key. Make it available to **Functions** at runtime (or to all scopes if your Netlify plan does not offer per-scope settings).
3. If the site uses a different public origin, add `SITE_ORIGIN` with that exact origin, for example `https://example.com`.
4. Trigger a new deploy so the function receives the updated environment values.
5. In the dashboard's Logs → AI settings, select a model and choose **Test Connection**. The test makes a billable OpenRouter request.

The function accepts only the models exposed in the UI, limits message size and response tokens, checks the site origin, and applies a per-IP in-memory request throttle. That throttle is best-effort and is not a substitute for authentication or provider-side spending limits. The site is publicly reachable, so set a strict spending cap on the OpenRouter key. Web-search requests may incur additional provider charges.

The OpenRouter key configured for Manus or stored as a GitHub Actions secret is not automatically available to Netlify Functions. Configure the Netlify environment variable separately.
