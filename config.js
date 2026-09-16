// Zentrale Einstellungen für die Unti-Präsenzliste.
// Vor dem ersten Start ausfüllen (siehe README.md, Abschnitt "Einrichtung").

export const FIREBASE_CONFIG = {
  apiKey: 'BITTE_AUSFUELLEN',
  authDomain: 'BITTE_AUSFUELLEN.firebaseapp.com',
  projectId: 'BITTE_AUSFUELLEN',
  storageBucket: 'BITTE_AUSFUELLEN.firebasestorage.app',
  messagingSenderId: 'BITTE_AUSFUELLEN',
  appId: 'BITTE_AUSFUELLEN',
}

// Kein individueller Login pro Leitungsperson — alle teilen sich ein Firebase-Auth-Konto mit
// diesem festen E-Mail-Namen (Login-Maske fragt nur noch das Passwort ab, siehe app.js). Muss
// exakt so unter Authentication → Users in der Firebase-Konsole angelegt werden (frei
// wählbares, gemeinsames Passwort).
export const MASTER_LOGIN_EMAIL = 'unti@kirche-wigarten.ch'

// iCal-Feed der Kirchgemeinde (Termine für den Unti).
export const ICAL_URL = 'https://admin.kirche-wigarten.ch/ical/?user=315f40bd82d57d1e2ddae5a5279c6b33&egs=18'

// URL des eigenen Cloudflare Workers (siehe cloudflare-worker/README.md) — leitet den
// obigen iCal-Feed mit den nötigen CORS-Headern an den Browser weiter. Erst nach dem
// Deployment des Workers eintragen; ohne gültige URL wird nur aus Firestore gelesen
// (bereits einmal importierte Termine bleiben also sichtbar, es kommen nur keine neuen dazu).
export const ICAL_PROXY_URL = ''
