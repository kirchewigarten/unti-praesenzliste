# Unti-Präsenzliste

Kleine, eigenständige Web-App für die Anwesenheitskontrolle im Konfirmandenunterricht (Unti)
der Kirchgemeinde Wigarten. Termine kommen automatisch aus dem Kirchenkalender
(`admin.kirche-wigarten.ch`), Personen (inkl. Geburtstag und Klasse 1./2./3.) werden direkt in
der App verwaltet.

## Technik

- Reines HTML/CSS/JavaScript (ES-Module), kein Build-Schritt nötig.
- Firebase (Firestore für die Daten, Authentication für den Login) — Gratis-Plan reicht.
- Ein winziger Cloudflare Worker als CORS-Proxy für den iCal-Feed (Gratis-Plan, keine
  Kreditkarte nötig).

## Einrichtung (einmalig)

### 1. Firebase-Projekt anlegen

1. [console.firebase.google.com](https://console.firebase.google.com/) → neues Projekt (z.B. "unti-praesenzliste").
2. **Build → Firestore Database** → Datenbank erstellen (Produktionsmodus, Region `eur3` (Zürich) empfohlen).
3. **Build → Authentication** → **Sign-in method** → **E-Mail/Passwort** aktivieren.
4. **Authentication → Users → Add user** — genau EIN gemeinsames Konto anlegen, mit der
   E-Mail-Adresse aus `MASTER_LOGIN_EMAIL` in `config.js` und einem frei gewählten Passwort,
   das alle Leitungspersonen kennen (siehe `config.js`-Kommentar).
5. **Projekteinstellungen (Zahnrad) → Allgemein → Meine Apps → Web-App hinzufügen** — die
   angezeigten Werte (`apiKey`, `authDomain`, …) in [`config.js`](config.js) eintragen.

### 2. Firestore-Regeln setzen

Die Datei [`firestore.rules`](firestore.rules) lässt Lesen/Schreiben nur für angemeldete
Konten zu. In der Firebase-Konsole unter **Firestore Database → Regeln** einfügen und
veröffentlichen (oder per Firebase-CLI: `firebase deploy --only firestore:rules`).

### 3. iCal-Proxy deployen

Siehe [`cloudflare-worker/ical-proxy.js`](cloudflare-worker/ical-proxy.js) — Kopie in
dash.cloudflare.com als neuer Worker einfügen, deployen, die resultierende
`*.workers.dev`-URL in [`config.js`](config.js) als `ICAL_PROXY_URL` eintragen.

### 4. Hosting

Die Dateien in diesem Repo sind rein statisch — irgendein Static-Hosting reicht, z.B.:

- **Firebase Hosting** (passt zum ohnehin genutzten Firebase-Projekt):
  ```
  npm install -g firebase-tools
  firebase login
  firebase init hosting   # Public-Verzeichnis: Repo-Root
  firebase deploy
  ```
- Oder GitHub Pages / Cloudflare Pages / jeder andere Static-Host — einfach den Repo-Inhalt hochladen.

## Verwendung

Nach dem Login gibt es drei Laschen:

- **Absenzen**: Termin oben auswählen (der Kalender-Feed liefert ohnehin nur Unti-Termine —
  Titel mit "Recharge" oder "Praktikum"/"Untipraktikum" werden zusätzlich immer ausgeblendet,
  da das keine regulären Unterrichtstermine sind). Fehlt ein Termin, lässt er sich unten
  manuell hinzufügen. Auf eine Status-Zelle klicken, um durchzuschalten: nicht erfasst →
  Anwesend → Abgemeldet → Unentschuldigt → nicht erfasst.
- **Übersicht**: reine Lese-Ansicht — alle Personen als Zeilen, alle (gefilterten) Termine als
  Spalten, Status farbig markiert. Zum Ändern eines Status in die Absenzen-Lasche wechseln.
- **Personen**: "+ Person hinzufügen" für neue Teilnehmende (Vorname, Nachname, Geburtstag,
  Klasse, Rolle Teilnehmer/Leiter — Leiter erscheinen in allen Listen zuoberst). Auf eine
  Zeile klicken, um eine bestehende Person zu bearbeiten oder zu löschen. Über "Personen aus
  CSV importieren" lässt sich eine Liste importieren — die Spalten Vorname/Nachname/
  Geburtsdatum/Klasse werden automatisch erkannt, unabhängig von Reihenfolge und weiteren
  Spalten in der Datei; bereits vorhandene Personen (gleicher Vor-/Nachname) werden nur
  ergänzt, nicht dupliziert.

## Was geprüft wurde — und was nicht

- Der ICS-Parser (`ics-parser.js`) wurde gegen den echten Kalender-Feed getestet: 52 Termine,
  davon 27 mit "Unti" im Titel; die Zeiten liegen im Feed als UTC vor (z.B.
  `DTSTART:20250921T163000Z`), der Parser rechnet korrekt nach Europe/Zurich um (Sommerzeit
  16:30 UTC → 18:30 lokal, Winterzeit 09:00 UTC → 10:00 lokal — beide Fälle stichprobenartig
  verifiziert).
- **Nicht getestet**, weil dafür ein echtes Firebase-Projekt mit echten Zugangsdaten nötig ist:
  Login, Firestore-Speicherung, der Cloudflare-Worker-Proxy im Browser. Bitte nach der
  Einrichtung einmal durchklicken, bevor die App den Leiterinnen und Leitern gezeigt wird.

## Datenschutz

Die App speichert Namen und Geburtsdaten von Minderjährigen. Zugriff ist auf Personen mit
dem gemeinsamen Master-Passwort beschränkt — es lohnt sich trotzdem, vor dem Einsatz kurz zu
prüfen, ob das für die Kirchgemeinde ausreichend ist oder ob z.B. weitere Einschränkungen
(Datenexport, Löschfristen) gewünscht sind.
