import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js'
import { FIREBASE_CONFIG, MASTER_LOGIN_EMAIL, ICAL_URL, ICAL_PROXY_URL } from './config.js'
import { parseIcs } from './ics-parser.js'
import { personenAusCsv } from './csv-import.js'

const STATUS_REIHENFOLGE = [null, 'anwesend', 'abgemeldet', 'unentschuldigt']
const STATUS_LABEL = { anwesend: 'Anwesend', abgemeldet: 'Abgemeldet', unentschuldigt: 'Unentschuldigt' }
const STATUS_KUERZEL = { anwesend: 'A', abgemeldet: 'Ab', unentschuldigt: 'U' }

// Termine mit diesen Wörtern im Titel werden standardmässig nie angezeigt (weder in der
// Terminauswahl noch in der Übersicht) — unabhängig vom Suchbegriff im Filterfeld.
// "praktikum" erfasst per Teilstring sowohl "Praktikum" als auch "Untipraktikum".
const AUSGESCHLOSSENE_TERMIN_STICHWOERTER = ['recharge', 'praktikum']

function rolleRang(rolle) {
  return rolle === 'leiter' ? 0 : 1
}

// Reihenfolge, nach der die Icons in den Tabellenköpfen den Sortierzustand anzeigen.
const SORTIER_ICON = { keine: '⇅', auf: '▲', ab: '▼' }

// Schuljahr-Grenze: beginnt immer am 1. August. "2025" steht für das Schuljahr 2025/26.
function schuljahrVon(datumIso) {
  const [jahr, monat] = datumIso.split('-').map(Number)
  return monat >= 8 ? jahr : jahr - 1
}

function schuljahrLabel(startJahr) {
  return `${startJahr}/${String(startJahr + 1).slice(-2)}`
}

function aktuellesSchuljahrStart() {
  const heute = new Date()
  return heute.getMonth() + 1 >= 8 ? heute.getFullYear() : heute.getFullYear() - 1
}

if (FIREBASE_CONFIG.apiKey === 'BITTE_AUSFUELLEN') {
  zeigeFehler(
    'Die Datei config.js ist noch nicht ausgefüllt. Bitte die Firebase-Zugangsdaten eintragen ' +
      '(siehe README.md, Abschnitt „Einrichtung“).',
  )
} else {
  starteApp()
}

function zeigeFehler(text) {
  document.getElementById('fehler-banner').textContent = text
  document.getElementById('fehler-banner').hidden = false
}

function starteApp() {
  const app = initializeApp(FIREBASE_CONFIG)
  const auth = getAuth(app)
  const db = getFirestore(app)

  const personenCol = collection(db, 'personen')
  const termineCol = collection(db, 'termine')
  const anwesenheitenCol = collection(db, 'anwesenheiten')

  let personen = []
  let termine = []
  let anwesenheitenAktuell = new Map() // personId -> status
  let ausgewaehlterTerminId = null
  let sortierSpalte = 'geburtstag'
  let sortierRichtung = 1 // 1 = aufsteigend, -1 = absteigend
  let gewaehltesSchuljahr = aktuellesSchuljahrStart()

  const el = {
    loginForm: document.getElementById('login-form'),
    loginFehler: document.getElementById('login-fehler'),
    loginScreen: document.getElementById('login-screen'),
    app: document.getElementById('app'),
    abmelden: document.getElementById('abmelden'),
    terminSelect: document.getElementById('termin-select'),
    terminChips: document.getElementById('termin-chips'),
    terminInfoTitel: document.getElementById('termin-info-titel'),
    terminAlleUmschalten: document.getElementById('termin-alle-umschalten'),
    terminAbschliessenButton: document.getElementById('termin-abschliessen-button'),
    terminManuellForm: document.getElementById('termin-manuell-form'),
    icalStatus: document.getElementById('ical-status'),
    tabelle: document.getElementById('personen-tabelle-body'),
    personenVerwaltungTabelle: document.getElementById('personen-verwaltung-body'),
    personForm: document.getElementById('person-form'),
    personDialog: document.getElementById('person-dialog'),
    personDialogTitel: document.getElementById('person-dialog-titel'),
    personLoeschen: document.getElementById('person-loeschen'),
    personAbbrechen: document.getElementById('person-abbrechen'),
    neuePerson: document.getElementById('neue-person'),
    tabButtons: document.querySelectorAll('.tab-button'),
    tabPanels: {
      absenzen: document.getElementById('tab-absenzen'),
      uebersicht: document.getElementById('tab-uebersicht'),
      personen: document.getElementById('tab-personen'),
    },
    csvImportForm: document.getElementById('csv-import-form'),
    csvImportStatus: document.getElementById('csv-import-status'),
    uebersichtKopfzeile: document.getElementById('uebersicht-kopfzeile'),
    uebersichtTabelle: document.getElementById('uebersicht-tabelle-body'),
    uebersichtSchuljahr: document.getElementById('uebersicht-schuljahr'),
    absenzenSchuljahr: document.getElementById('absenzen-schuljahr'),
    absenzenSchuljahrUmschalten: document.getElementById('absenzen-schuljahr-umschalten'),
  }

  // Die Schuljahr-Auswahl ist zwischen Absenzen- und Übersicht-Lasche gekoppelt: eine Änderung
  // in der einen Lasche wirkt sich auch auf die andere aus (gemeinsamer Zustand: gewaehltesSchuljahr).
  el.uebersichtSchuljahr.addEventListener('change', () => {
    gewaehltesSchuljahr = Number(el.uebersichtSchuljahr.value)
    terminSelectNeuBefuellen()
    uebersichtNeuZeichnen()
  })

  el.absenzenSchuljahr.addEventListener('change', () => {
    gewaehltesSchuljahr = Number(el.absenzenSchuljahr.value)
    terminSelectNeuBefuellen()
    uebersichtNeuZeichnen()
  })

  el.absenzenSchuljahrUmschalten.addEventListener('click', () => {
    el.absenzenSchuljahr.hidden = !el.absenzenSchuljahr.hidden
    el.absenzenSchuljahrUmschalten.textContent = el.absenzenSchuljahr.hidden
      ? 'Andere Schuljahre anzeigen'
      : 'Andere Schuljahre ausblenden'
  })

  // --- Tabs: Absenzen / Personen ---
  for (const button of el.tabButtons) {
    button.addEventListener('click', () => {
      for (const b of el.tabButtons) b.classList.toggle('aktiv', b === button)
      for (const [name, panel] of Object.entries(el.tabPanels)) {
        panel.hidden = name !== button.dataset.tab
      }
    })
  }

  // --- Sortierbare Tabellenköpfe (Absenzen + Personen; gemeinsamer Sortierzustand oben) ---
  for (const kopfZelle of document.querySelectorAll('th[data-sort]')) {
    kopfZelle.classList.add('sortierbar')
    kopfZelle.title = 'Klicken zum Sortieren'
    const icon = document.createElement('span')
    icon.className = 'sortier-icon'
    kopfZelle.appendChild(icon)
    kopfZelle.addEventListener('click', () => sortierNach(kopfZelle.dataset.sort))
  }
  sortierIconsAktualisieren()

  function sortierNach(spalte) {
    if (sortierSpalte === spalte) {
      sortierRichtung *= -1
    } else {
      sortierSpalte = spalte
      sortierRichtung = 1
    }
    personenNeuSortieren()
    sortierIconsAktualisieren()
    tabelleNeuZeichnen()
    personenVerwaltungNeuZeichnen()
    uebersichtNeuZeichnen()
  }

  function sortierIconsAktualisieren() {
    for (const kopfZelle of document.querySelectorAll('th[data-sort]')) {
      const icon = kopfZelle.querySelector('.sortier-icon')
      const aktiv = kopfZelle.dataset.sort === sortierSpalte
      icon.textContent = aktiv ? (sortierRichtung === 1 ? SORTIER_ICON.auf : SORTIER_ICON.ab) : SORTIER_ICON.keine
      icon.classList.toggle('aktiv', aktiv)
    }
  }

  // Leiter stehen immer zuoberst (feste Regel); innerhalb der beiden Gruppen wird nach der
  // gewählten Spalte sortiert. Leere Werte landen immer am Schluss, unabhängig von der Richtung.
  function personenNeuSortieren() {
    personen.sort((a, b) => rolleRang(a.rolle) - rolleRang(b.rolle) || vergleicheSpalte(a, b, sortierSpalte))
  }

  function vergleicheSpalte(a, b, spalte) {
    if (spalte === 'status') {
      const rangA = STATUS_REIHENFOLGE.indexOf(anwesenheitenAktuell.get(a.id) ?? null)
      const rangB = STATUS_REIHENFOLGE.indexOf(anwesenheitenAktuell.get(b.id) ?? null)
      return sortierRichtung * (rangA - rangB)
    }
    const wertA = a[spalte] || null
    const wertB = b[spalte] || null
    if (wertA === null || wertB === null) {
      if (wertA === wertB) return 0
      return wertA === null ? 1 : -1 // leere Werte immer am Schluss
    }
    if (spalte === 'klasse') return sortierRichtung * (Number(wertA) - Number(wertB))
    return sortierRichtung * String(wertA).localeCompare(String(wertB), 'de-CH')
  }

  // --- Login ---
  onAuthStateChanged(auth, user => {
    el.loginScreen.hidden = !!user
    el.app.hidden = !user
    if (user) {
      icalSynchronisieren()
    }
  })

  el.loginForm.addEventListener('submit', async e => {
    e.preventDefault()
    el.loginFehler.hidden = true
    const passwort = el.loginForm.passwort.value
    try {
      await signInWithEmailAndPassword(auth, MASTER_LOGIN_EMAIL, passwort)
    } catch (err) {
      el.loginFehler.textContent = 'Login fehlgeschlagen: ' + (err.code ?? err.message)
      el.loginFehler.hidden = false
    }
  })

  el.abmelden.addEventListener('click', () => signOut(auth))

  // --- Termine: live aus Firestore + einmalig aus iCal nachführen ---
  onSnapshot(query(termineCol, orderBy('datum', 'desc')), snap => {
    termine = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    terminSelectNeuBefuellen()
    uebersichtNeuZeichnen()
  })

  async function icalSynchronisieren() {
    if (!ICAL_PROXY_URL) {
      el.icalStatus.textContent = 'Kein iCal-Proxy eingetragen — es werden nur bereits gespeicherte Termine angezeigt.'
      return
    }
    el.icalStatus.textContent = 'Synchronisiere Termine aus kOOL …'
    try {
      const res = await fetch(`${ICAL_PROXY_URL}?url=${encodeURIComponent(ICAL_URL)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const events = parseIcs(await res.text())
      const batch = writeBatch(db)
      let anzahl = 0
      for (const ev of events) {
        if (ev.abgesagt) continue
        batch.set(
          doc(termineCol, sichereId(ev.uid)),
          { datum: ev.datum, zeit: ev.zeit, titel: ev.titel, ort: ev.ort, quelle: 'ical', aktualisiertAm: serverTimestamp() },
          { merge: true },
        )
        anzahl++
      }
      await batch.commit()
      el.icalStatus.textContent = `${anzahl} Termine aus kOOL synchronisiert.`
    } catch (err) {
      el.icalStatus.textContent = 'iCal-Synchronisierung fehlgeschlagen: ' + err.message + ' (gespeicherte Termine bleiben erhalten.)'
    }
  }

  function sichereId(text) {
    return text.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200)
  }

  // Wird sowohl für die Terminauswahl (Absenzen-Lasche) als auch für die Übersicht verwendet,
  // damit beide dieselbe Ausschlussliste anwenden.
  function termineGefiltert() {
    return termine.filter(t => {
      const titel = (t.titel ?? '').toLowerCase()
      return !AUSGESCHLOSSENE_TERMIN_STICHWOERTER.some(wort => titel.includes(wort))
    })
  }

  // Termine, die vor mehr als 3 Monaten stattfanden, erscheinen in der Auswahl gar nicht mehr
  // (bleiben aber in der Datenbank und weiterhin vollständig in der Übersicht sichtbar).
  function terminNichtZuAlt(t) {
    const grenze = new Date()
    grenze.setMonth(grenze.getMonth() - 3)
    return t.datum >= grenze.toISOString().slice(0, 10)
  }

  function terminSelectNeuBefuellen() {
    const alleGefiltert = termineGefiltert()
    schuljahrOptionenAktualisieren(alleGefiltert)
    const schuljahrGefiltert = alleGefiltert.filter(t => schuljahrVon(t.datum) === gewaehltesSchuljahr)
    // Die 3-Monats-Regel gilt nur, solange das aktuelle (laufende) Schuljahr angezeigt wird —
    // in einem bewusst ausgewählten anderen Schuljahr wäre sie sonst gleichbedeutend mit "alles
    // ausblenden", da dort ohnehin (fast) alle Termine länger als 3 Monate zurückliegen.
    const istAktuellesSchuljahr = gewaehltesSchuljahr === aktuellesSchuljahrStart()
    const eingeschraenkt = istAktuellesSchuljahr ? schuljahrGefiltert.filter(terminNichtZuAlt) : schuljahrGefiltert
    // Aufsteigend sortiert: älteste (noch nicht ausgeblendete) Termine oben, künftige unten.
    const gefiltert = [...eingeschraenkt].reverse()
    const vorherAusgewaehlt = ausgewaehlterTerminId
    el.terminSelect.innerHTML = ''
    for (const t of gefiltert) {
      const option = document.createElement('option')
      option.value = t.id
      option.textContent = terminBeschriftung(t)
      el.terminSelect.appendChild(option)
    }
    if (gefiltert.some(t => t.id === vorherAusgewaehlt)) {
      el.terminSelect.value = vorherAusgewaehlt
    } else if (gefiltert.length > 0) {
      // Nächster künftiger Termin bevorzugt, sonst der letzte (Liste ist jetzt aufsteigend sortiert).
      const heute = new Date().toISOString().slice(0, 10)
      const kuenftige = gefiltert.find(t => t.datum >= heute)
      el.terminSelect.value = (kuenftige ?? gefiltert[gefiltert.length - 1]).id
    }
    terminChipsNeuZeichnen(gefiltert)
    terminAusgewaehlt()
  }

  // Datums-Chip-Leiste als komfortablere Alternative zum <select> (das als verstecktes,
  // vollständiges Fallback über "Alle Termine ▾" erreichbar bleibt).
  function terminChipsNeuZeichnen(gefiltert) {
    const aktuelleId = el.terminSelect.value
    el.terminChips.innerHTML = ''
    for (const t of gefiltert) {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'chip' + (t.id === aktuelleId ? ' aktiv' : '')
      chip.dataset.terminId = t.id
      const datum = new Date(t.datum + 'T00:00:00')
      const tag = document.createElement('span')
      tag.className = 'tag'
      tag.textContent = datum.toLocaleDateString('de-CH', { weekday: 'short' })
      const kurzDatum = document.createElement('span')
      kurzDatum.textContent = datum.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: '2-digit' })
      chip.append(tag, kurzDatum)
      chip.title = terminBeschriftung(t)
      chip.addEventListener('click', () => terminAuswaehlen(t.id))
      el.terminChips.appendChild(chip)
    }
    el.terminChips.querySelector('.chip.aktiv')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }

  function terminAuswaehlen(id) {
    el.terminSelect.value = id
    for (const chip of el.terminChips.querySelectorAll('.chip')) {
      chip.classList.toggle('aktiv', chip.dataset.terminId === id)
    }
    chipsAktuellerAuswahl()?.scrollIntoView({ inline: 'center', block: 'nearest' })
    terminAusgewaehlt()
  }

  function chipsAktuellerAuswahl() {
    return el.terminChips.querySelector('.chip.aktiv')
  }

  el.terminAlleUmschalten.addEventListener('click', () => {
    el.terminSelect.hidden = !el.terminSelect.hidden
    el.terminAlleUmschalten.textContent = el.terminSelect.hidden ? 'Alle Termine ▾' : 'Alle Termine ▴'
  })

  function terminBeschriftung(t) {
    const datum = new Date(t.datum + 'T00:00:00')
    const datumText = datum.toLocaleDateString('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
    const zeitText = t.zeit ? `, ${t.zeit}` : ''
    const titelText = t.titel ? ` – ${t.titel}` : ''
    return `${datumText}${zeitText}${titelText}`
  }

  el.terminSelect.addEventListener('change', () => terminAuswaehlen(el.terminSelect.value))

  el.terminAbschliessenButton.addEventListener('click', async () => {
    if (!ausgewaehlterTerminId) return
    const aktuellerTermin = termine.find(t => t.id === ausgewaehlterTerminId)
    const neuerWert = !(aktuellerTermin?.abgeschlossen ?? false)
    await updateDoc(doc(termineCol, ausgewaehlterTerminId), { abgeschlossen: neuerWert })
  })

  el.terminManuellForm.addEventListener('submit', async e => {
    e.preventDefault()
    const form = e.target
    const datum = form.datum.value
    const zeit = form.zeit.value || null
    const titel = form.titel.value.trim() || null
    if (!datum) return
    const id = sichereId(`manuell-${datum}-${titel ?? Date.now()}`)
    await setDoc(doc(termineCol, id), { datum, zeit, titel, ort: null, quelle: 'manuell', aktualisiertAm: serverTimestamp() })
    form.reset()
    ausgewaehlterTerminId = id
  })

  // --- Personen: live Liste ---
  onSnapshot(query(personenCol, orderBy('nachname')), snap => {
    personen = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    personenNeuSortieren()
    tabelleNeuZeichnen()
    personenVerwaltungNeuZeichnen()
    uebersichtNeuZeichnen()
  })

  // --- Anwesenheiten über alle Termine (nur lesend, für die Übersicht-Lasche) ---
  let alleAnwesenheiten = new Map() // `${terminId}_${personId}` -> status
  onSnapshot(anwesenheitenCol, snap => {
    alleAnwesenheiten = new Map(snap.docs.map(d => [`${d.data().terminId}_${d.data().personId}`, d.data().status]))
    uebersichtNeuZeichnen()
  })

  el.neuePerson.addEventListener('click', () => personDialogOeffnen(null))
  el.personAbbrechen.addEventListener('click', () => el.personDialog.close())

  // --- CSV-Import ---
  el.csvImportForm.addEventListener('submit', async e => {
    e.preventDefault()
    const form = e.target
    const datei = form.csv.files[0]
    if (!datei) return

    el.csvImportStatus.textContent = 'Importiere …'
    try {
      const text = await csvDateiAlsText(datei)
      const eintraege = personenAusCsv(text)
      // Lokale Arbeitskopie, damit Duplikate innerhalb derselben Import-Datei erkannt werden,
      // auch bevor der Live-Snapshot (onSnapshot oben) die neu angelegten Personen nachzieht.
      const bekannt = [...personen]
      let neu = 0
      let ergaenzt = 0
      let uebersprungen = 0

      for (const eintrag of eintraege) {
        const bestehend = bekannt.find(
          p =>
            p.vorname.trim().toLowerCase() === eintrag.vorname.toLowerCase() &&
            p.nachname.trim().toLowerCase() === eintrag.nachname.toLowerCase(),
        )
        if (!bestehend) {
          const ref = await addDoc(personenCol, {
            vorname: eintrag.vorname,
            nachname: eintrag.nachname,
            geburtstag: eintrag.geburtstag,
            klasse: eintrag.klasse,
            rolle: 'teilnehmer',
            erstelltAm: serverTimestamp(),
          })
          bekannt.push({ id: ref.id, ...eintrag })
          neu++
          continue
        }
        const aenderungen = {}
        if (!bestehend.geburtstag && eintrag.geburtstag) aenderungen.geburtstag = eintrag.geburtstag
        if (!bestehend.klasse && eintrag.klasse) aenderungen.klasse = eintrag.klasse
        if (Object.keys(aenderungen).length > 0) {
          await updateDoc(doc(personenCol, bestehend.id), aenderungen)
          Object.assign(bestehend, aenderungen)
          ergaenzt++
        } else {
          uebersprungen++
        }
      }

      el.csvImportStatus.textContent =
        `${neu} neu hinzugefügt, ${ergaenzt} ergänzt, ${uebersprungen} bereits vollständig vorhanden.`
      form.reset()
    } catch (err) {
      el.csvImportStatus.textContent = 'Import fehlgeschlagen: ' + err.message
    }
  })

  // Liest die Datei bytegenau ein und erkennt automatisch, ob sie UTF-8- oder
  // Windows-1252/Latin-1-kodiert ist (typisch bei Excel-/Kirchendatenbank-Exporten) — sonst
  // würden Umlaute wie "Joël" als kaputte Zeichen importiert.
  async function csvDateiAlsText(datei) {
    const buffer = await datei.arrayBuffer()
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    } catch {
      return new TextDecoder('windows-1252').decode(buffer)
    }
  }

  el.personForm.addEventListener('submit', async e => {
    e.preventDefault()
    const form = e.target
    const daten = {
      vorname: form.vorname.value.trim(),
      nachname: form.nachname.value.trim(),
      geburtstag: form.geburtstag.value || null,
      klasse: form.klasse.value || null,
      rolle: form.rolle.value,
    }
    if (!daten.vorname || !daten.nachname) return
    const bearbeiteteId = form.dataset.personId
    if (bearbeiteteId) {
      await updateDoc(doc(personenCol, bearbeiteteId), daten)
    } else {
      await addDoc(personenCol, { ...daten, erstelltAm: serverTimestamp() })
    }
    el.personDialog.close()
  })

  el.personLoeschen.addEventListener('click', async () => {
    const id = el.personForm.dataset.personId
    if (!id) return
    if (!confirm('Diese Person wirklich löschen? Erfasste Anwesenheiten dieser Person bleiben in der Datenbank, werden aber nicht mehr angezeigt.')) return
    await deleteDoc(doc(personenCol, id))
    el.personDialog.close()
  })

  function personDialogOeffnen(person) {
    const form = el.personForm
    form.reset()
    if (person) {
      el.personDialogTitel.textContent = 'Person bearbeiten'
      form.dataset.personId = person.id
      form.vorname.value = person.vorname ?? ''
      form.nachname.value = person.nachname ?? ''
      form.geburtstag.value = person.geburtstag ?? ''
      form.klasse.value = person.klasse ?? ''
      form.rolle.value = person.rolle ?? 'teilnehmer'
      el.personLoeschen.hidden = false
    } else {
      el.personDialogTitel.textContent = 'Person hinzufügen'
      delete form.dataset.personId
      el.personLoeschen.hidden = true
    }
    el.personDialog.showModal()
  }

  // --- Anwesenheit für den gewählten Termin ---
  let anwesenheitenUnsubscribe = null

  function terminAusgewaehlt() {
    ausgewaehlterTerminId = el.terminSelect.value || null
    terminInfoAktualisieren()
    if (anwesenheitenUnsubscribe) anwesenheitenUnsubscribe()
    anwesenheitenAktuell = new Map()
    if (!ausgewaehlterTerminId) {
      personenNeuSortieren()
      tabelleNeuZeichnen()
      personenVerwaltungNeuZeichnen()
      uebersichtNeuZeichnen()
      return
    }
    anwesenheitenUnsubscribe = onSnapshot(
      query(anwesenheitenCol, where('terminId', '==', ausgewaehlterTerminId)),
      snap => {
        anwesenheitenAktuell = new Map(snap.docs.map(d => [d.data().personId, d.data().status]))
        // Bei Sortierung nach Status muss die Reihenfolge in allen Laschen nachgezogen werden.
        personenNeuSortieren()
        tabelleNeuZeichnen()
        personenVerwaltungNeuZeichnen()
        uebersichtNeuZeichnen()
      },
    )
  }

  function terminInfoAktualisieren() {
    const t = termine.find(x => x.id === ausgewaehlterTerminId)
    el.terminInfoTitel.textContent = t ? terminBeschriftung(t) : 'Kein Termin ausgewählt'
    const gesperrt = t?.abgeschlossen ?? false
    el.terminAbschliessenButton.textContent = gesperrt ? 'Termin wieder aktivieren' : 'Termin abschliessen'
    el.terminAbschliessenButton.classList.toggle('gesperrt', gesperrt)
    el.terminAbschliessenButton.disabled = !t
  }

  function terminIstGesperrt() {
    return termine.find(t => t.id === ausgewaehlterTerminId)?.abgeschlossen ?? false
  }

  async function statusSetzen(personId, neuerStatus) {
    if (!ausgewaehlterTerminId) {
      alert('Bitte zuerst einen Termin auswählen.')
      return
    }
    if (terminIstGesperrt()) return
    const id = `${ausgewaehlterTerminId}_${personId}`
    if (neuerStatus === null) {
      await deleteDoc(doc(anwesenheitenCol, id))
    } else {
      await setDoc(doc(anwesenheitenCol, id), {
        terminId: ausgewaehlterTerminId,
        personId,
        status: neuerStatus,
        geaendertAm: serverTimestamp(),
        geaendertVon: auth.currentUser?.email ?? null,
      })
    }
  }

  function tabelleNeuZeichnen() {
    const gesperrt = terminIstGesperrt()
    el.tabelle.innerHTML = ''
    for (const person of personen) {
      const status = anwesenheitenAktuell.get(person.id) ?? null
      const zeile = document.createElement('tr')
      zeile.className = [status ? `status-${status}` : '', person.rolle === 'leiter' ? 'leiter-zeile' : ''].join(' ').trim()

      const vornameZelle = document.createElement('td')
      vornameZelle.textContent = person.vorname

      const nachnameZelle = document.createElement('td')
      nachnameZelle.textContent = person.nachname

      const geburtstagZelle = document.createElement('td')
      geburtstagZelle.textContent = person.geburtstag ? formatiereDatum(person.geburtstag) : ''

      const klasseZelle = document.createElement('td')
      klasseZelle.textContent = person.klasse ?? ''

      const statusZelle = document.createElement('td')
      statusZelle.className = gesperrt ? 'status-zelle gesperrt' : 'status-zelle'
      statusZelle.textContent = status ? STATUS_LABEL[status] : '–'
      if (gesperrt) {
        statusZelle.title = 'Termin ist abgeschlossen — zum Ändern zuerst wieder aktivieren'
      } else {
        statusZelle.title = 'Klicken, um den Status zu wechseln'
        statusZelle.addEventListener('click', () => {
          const naechsterIndex = (STATUS_REIHENFOLGE.indexOf(status) + 1) % STATUS_REIHENFOLGE.length
          statusSetzen(person.id, STATUS_REIHENFOLGE[naechsterIndex])
        })
      }

      zeile.append(vornameZelle, nachnameZelle, geburtstagZelle, klasseZelle, statusZelle)
      el.tabelle.appendChild(zeile)
    }
  }

  function personenVerwaltungNeuZeichnen() {
    el.personenVerwaltungTabelle.innerHTML = ''
    for (const person of personen) {
      const zeile = document.createElement('tr')
      zeile.className = [
        'name-zelle',
        person.rolle === 'leiter' ? 'leiter-zeile' : '',
        person.klasse ? `klasse-${person.klasse}` : '',
      ]
        .join(' ')
        .trim()
      zeile.title = 'Klicken, um die Person zu bearbeiten'
      zeile.addEventListener('click', () => personDialogOeffnen(person))

      const vornameZelle = document.createElement('td')
      vornameZelle.textContent = person.vorname

      const nachnameZelle = document.createElement('td')
      nachnameZelle.textContent = person.nachname

      const geburtstagZelle = document.createElement('td')
      geburtstagZelle.textContent = person.geburtstag ? formatiereDatum(person.geburtstag) : ''

      const klasseZelle = document.createElement('td')
      klasseZelle.textContent = person.klasse ?? ''

      const rolleZelle = document.createElement('td')
      rolleZelle.textContent = person.rolle === 'leiter' ? 'Leiter' : 'Teilnehmer'

      zeile.append(vornameZelle, nachnameZelle, geburtstagZelle, klasseZelle, rolleZelle)
      el.personenVerwaltungTabelle.appendChild(zeile)
    }
  }

  // Aktualisiert die Schuljahr-Auswahl in Absenzen UND Übersicht (gemeinsamer Zustand: siehe
  // gewaehltesSchuljahr weiter oben).
  function schuljahrOptionenAktualisieren(termineFuerJahre) {
    const jahre = [...new Set(termineFuerJahre.map(t => schuljahrVon(t.datum)))].sort((a, b) => a - b)
    if (jahre.length === 0) return
    if (!jahre.includes(gewaehltesSchuljahr)) {
      gewaehltesSchuljahr = jahre.reduce((naechstes, jahr) =>
        Math.abs(jahr - gewaehltesSchuljahr) < Math.abs(naechstes - gewaehltesSchuljahr) ? jahr : naechstes,
      )
    }
    for (const select of [el.uebersichtSchuljahr, el.absenzenSchuljahr]) {
      const bisherige = [...select.options].map(o => o.value).join(',')
      if (bisherige !== jahre.join(',')) {
        select.innerHTML = ''
        for (const jahr of jahre) {
          const option = document.createElement('option')
          option.value = jahr
          option.textContent = schuljahrLabel(jahr)
          select.appendChild(option)
        }
      }
      select.value = gewaehltesSchuljahr
    }
  }

  function uebersichtNeuZeichnen() {
    const alleGefiltert = termineGefiltert()
    schuljahrOptionenAktualisieren(alleGefiltert)
    const termineAufsteigend = alleGefiltert.filter(t => schuljahrVon(t.datum) === gewaehltesSchuljahr).reverse()

    el.uebersichtKopfzeile.innerHTML = '<th>Name</th>'
    for (const t of termineAufsteigend) {
      const kopfZelle = document.createElement('th')
      kopfZelle.textContent = terminKurzBeschriftung(t)
      kopfZelle.title = terminBeschriftung(t)
      el.uebersichtKopfzeile.appendChild(kopfZelle)
    }

    el.uebersichtTabelle.innerHTML = ''
    for (const person of personen) {
      const zeile = document.createElement('tr')
      if (person.rolle === 'leiter') zeile.className = 'leiter-zeile'

      const nameZelle = document.createElement('td')
      nameZelle.textContent = `${person.vorname} ${person.nachname}`
      nameZelle.className = 'uebersicht-name-zelle'
      zeile.appendChild(nameZelle)

      for (const t of termineAufsteigend) {
        const status = alleAnwesenheiten.get(`${t.id}_${person.id}`) ?? null
        const zelle = document.createElement('td')
        zelle.className = status ? `status-${status}` : ''
        zelle.textContent = status ? STATUS_KUERZEL[status] : '–'
        zelle.title = terminBeschriftung(t)
        zeile.appendChild(zelle)
      }
      el.uebersichtTabelle.appendChild(zeile)
    }
  }

  function terminKurzBeschriftung(t) {
    const datum = new Date(t.datum + 'T00:00:00')
    return datum.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: '2-digit' })
  }

  function formatiereDatum(iso) {
    return new Date(iso + 'T00:00:00').toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }
}
