// CORS-Proxy für den iCal-Feed der Kirchgemeinde (admin.kirche-wigarten.ch liefert selbst
// keine CORS-Freigabe, ein Browser darf den Feed also nicht per fetch() laden). Leitet nur
// explizit erlaubte Feed-Anbieter weiter — kein offener Allzweck-Proxy.
//
// Deployment: dash.cloudflare.com → Workers & Pages → Create → "Create Worker" → Namen
// vergeben (z.B. "unti-ical-proxy") → Deploy → "Edit code" → Inhalt dieser Datei einfügen
// → Save and deploy. Die resultierende *.workers.dev-URL anschliessend in config.js als
// ICAL_PROXY_URL eintragen.

const ERLAUBTE_PREFIXE = ['https://admin.kirche-wigarten.ch/ical/']

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
}

export default {
  async fetch(request) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS })
    }

    const ziel = url.searchParams.get('url')
    if (!ziel || !ERLAUBTE_PREFIXE.some(prefix => ziel.startsWith(prefix))) {
      return new Response(`Nur folgende Feed-Anbieter sind erlaubt: ${ERLAUBTE_PREFIXE.join(', ')}`, {
        status: 400,
        headers: CORS_HEADERS,
      })
    }

    const antwort = await fetch(ziel, { headers: { 'User-Agent': 'unti-praesenzliste-ical-proxy' } })
    const text = await antwort.text()
    return new Response(text, {
      status: antwort.status,
      headers: { ...CORS_HEADERS, 'content-type': 'text/calendar; charset=utf-8' },
    })
  },
}
