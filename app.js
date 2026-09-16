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

  const el = {
    loginForm: document.getElementById('login-form'),
    loginFehler: document.getElementById('login-fehler'),
    loginScreen: document.getElementById('login-screen'),
    app: document.getElementById('app'),
    abmelden: document.getElementById('abmelden'),
    terminSuche: document.getElementById('termin-suche'),
    terminSelect: document.getElementById('termin-select'),
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
      personen: document.getElementById('tab-personen'),
    },
    csvImportForm: document.getElementById('csv-import-form'),
    csvImportStatus: document.getElementById('csv-import-status'),
  }

  // --- Tabs: Absenzen / Personen ---
  for (const button of el.tabButtons) {
    button.addEventListener('click', () => {
      for (const b of el.tabButtons) b.classList.toggle('aktiv', b === button)
      for (const [name, panel] of Object.entries(el.tabPanels)) {
        panel.hidden = name !== button.dataset.tab
      }
    })
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
  })

  async function icalSynchronisieren() {
    if (!ICAL_PROXY_URL) {
      el.icalStatus.textContent = 'Kein iCal-Proxy eingetragen — es werden nur bereits gespeicherte Termine angezeigt.'
      return
    }
    el.icalStatus.textContent = 'Synchronisiere Termine aus dem Kirchenkalender …'
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
      el.icalStatus.textContent = `${anzahl} Termine aus dem Kirchenkalender synchronisiert.`
    } catch (err) {
      el.icalStatus.textContent = 'iCal-Synchronisierung fehlgeschlagen: ' + err.message + ' (gespeicherte Termine bleiben erhalten.)'
    }
  }

  function sichereId(text) {
    return text.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200)
  }

  function terminSelectNeuBefuellen() {
    const suchbegriff = el.terminSuche.value.trim().toLowerCase()
    const gefiltert = termine.filter(t => !suchbegriff || (t.titel ?? '').toLowerCase().includes(suchbegriff))
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
      // Nächster künftiger Termin bevorzugt, sonst der zuletzt vergangene (Liste ist datum-absteigend sortiert).
      const heute = new Date().toISOString().slice(0, 10)
      const kuenftige = [...gefiltert].reverse().find(t => t.datum >= heute)
      el.terminSelect.value = (kuenftige ?? gefiltert[0]).id
    }
    terminAusgewaehlt()
  }

  function terminBeschriftung(t) {
    const datum = new Date(t.datum + 'T00:00:00')
    const datumText = datum.toLocaleDateString('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
    const zeitText = t.zeit ? `, ${t.zeit}` : ''
    const titelText = t.titel ? ` – ${t.titel}` : ''
    return `${datumText}${zeitText}${titelText}`
  }

  el.terminSuche.addEventListener('input', terminSelectNeuBefuellen)
  el.terminSelect.addEventListener('change', terminAusgewaehlt)

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
    // Filter leeren, sonst bleibt ein manuell hinzugefügter Termin ohne "Unti" im Titel
    // wegen der standardmässigen Vorfilterung unsichtbar (siehe #termin-suche in index.html).
    el.terminSuche.value = ''
    ausgewaehlterTerminId = id
  })

  // --- Personen: live Liste ---
  onSnapshot(query(personenCol, orderBy('nachname')), snap => {
    personen = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    tabelleNeuZeichnen()
    personenVerwaltungNeuZeichnen()
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
    if (anwesenheitenUnsubscribe) anwesenheitenUnsubscribe()
    anwesenheitenAktuell = new Map()
    if (!ausgewaehlterTerminId) {
      tabelleNeuZeichnen()
      return
    }
    anwesenheitenUnsubscribe = onSnapshot(
      query(anwesenheitenCol, where('terminId', '==', ausgewaehlterTerminId)),
      snap => {
        anwesenheitenAktuell = new Map(snap.docs.map(d => [d.data().personId, d.data().status]))
        tabelleNeuZeichnen()
      },
    )
  }

  async function statusSetzen(personId, neuerStatus) {
    if (!ausgewaehlterTerminId) {
      alert('Bitte zuerst einen Termin auswählen.')
      return
    }
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
    el.tabelle.innerHTML = ''
    for (const person of personen) {
      const status = anwesenheitenAktuell.get(person.id) ?? null
      const zeile = document.createElement('tr')
      zeile.className = status ? `status-${status}` : ''

      const vornameZelle = document.createElement('td')
      vornameZelle.textContent = person.vorname

      const nachnameZelle = document.createElement('td')
      nachnameZelle.textContent = person.nachname

      const geburtstagZelle = document.createElement('td')
      geburtstagZelle.textContent = person.geburtstag ? formatiereDatum(person.geburtstag) : ''

      const klasseZelle = document.createElement('td')
      klasseZelle.textContent = person.klasse ?? ''

      const statusZelle = document.createElement('td')
      statusZelle.className = 'status-zelle'
      statusZelle.textContent = status ? STATUS_LABEL[status] : '–'
      statusZelle.title = 'Klicken, um den Status zu wechseln'
      statusZelle.addEventListener('click', () => {
        const naechsterIndex = (STATUS_REIHENFOLGE.indexOf(status) + 1) % STATUS_REIHENFOLGE.length
        statusSetzen(person.id, STATUS_REIHENFOLGE[naechsterIndex])
      })

      zeile.append(vornameZelle, nachnameZelle, geburtstagZelle, klasseZelle, statusZelle)
      el.tabelle.appendChild(zeile)
    }
  }

  function personenVerwaltungNeuZeichnen() {
    el.personenVerwaltungTabelle.innerHTML = ''
    for (const person of personen) {
      const zeile = document.createElement('tr')
      zeile.className = 'name-zelle'
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

      zeile.append(vornameZelle, nachnameZelle, geburtstagZelle, klasseZelle)
      el.personenVerwaltungTabelle.appendChild(zeile)
    }
  }

  function formatiereDatum(iso) {
    return new Date(iso + 'T00:00:00').toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }
}
