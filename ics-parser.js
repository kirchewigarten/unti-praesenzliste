// Minimaler ICS-Parser (RFC 5545) — deckt genau das ab, was Kalender-Feeds für einzelne
// Termine liefern (VEVENT mit UID/DTSTART/SUMMARY/LOCATION/STATUS). Kein Anspruch auf
// Vollständigkeit (z.B. keine RRULE-Wiederholungsregeln), da der Feed pro Termin bereits
// ein eigenes VEVENT liefert.

function zeilenEntfalten(text) {
  const zeilen = text.replace(/\r\n/g, '\n').split('\n')
  const entfaltet = []
  for (const zeile of zeilen) {
    if ((zeile.startsWith(' ') || zeile.startsWith('\t')) && entfaltet.length > 0) {
      entfaltet[entfaltet.length - 1] += zeile.slice(1)
    } else if (zeile.trim() !== '') {
      entfaltet.push(zeile)
    }
  }
  return entfaltet
}

function textUnescapen(wert) {
  return wert
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

// DTSTART-Wert wie "20260921T163000Z" (UTC), "20260921T163000" (lokal/"floating", z.B. mit
// TZID-Parameter — der Parameter selbst wird beim Zeilen-Parsing verworfen) oder "20260921"
// (ganztägig) in { datum, zeit } zerlegen. Bei einem "Z"-Suffix (UTC) wird nach Europe/Zurich
// umgerechnet, damit Sommer-/Winterzeit korrekt berücksichtigt wird (churchtool.org, der
// Anbieter hinter admin.kirche-wigarten.ch, liefert DTSTART-Werte in UTC).
function datumZeitAus(dtstartRoh) {
  const istUtc = dtstartRoh.endsWith('Z')
  const ziffern = dtstartRoh.replace(/[^0-9T]/g, '')
  if (!ziffern.includes('T')) {
    return { datum: `${ziffern.slice(0, 4)}-${ziffern.slice(4, 6)}-${ziffern.slice(6, 8)}`, zeit: null }
  }
  if (!istUtc) {
    const t = ziffern.split('T')[1] ?? ''
    return {
      datum: `${ziffern.slice(0, 4)}-${ziffern.slice(4, 6)}-${ziffern.slice(6, 8)}`,
      zeit: t.length >= 4 ? `${t.slice(0, 2)}:${t.slice(2, 4)}` : null,
    }
  }
  const iso = `${ziffern.slice(0, 4)}-${ziffern.slice(4, 6)}-${ziffern.slice(6, 8)}T${ziffern.slice(9, 11)}:${ziffern.slice(11, 13)}:${ziffern.slice(13, 15)}Z`
  const teile = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso))
  const teil = typ => teile.find(p => p.type === typ)?.value
  return { datum: `${teil('year')}-${teil('month')}-${teil('day')}`, zeit: `${teil('hour')}:${teil('minute')}` }
}

export function parseIcs(text) {
  const zeilen = zeilenEntfalten(text)
  const events = []
  let aktuell = null

  for (const zeile of zeilen) {
    if (zeile === 'BEGIN:VEVENT') {
      aktuell = {}
      continue
    }
    if (zeile === 'END:VEVENT') {
      if (aktuell) events.push(aktuell)
      aktuell = null
      continue
    }
    if (!aktuell) continue

    const doppelpunkt = zeile.indexOf(':')
    if (doppelpunkt === -1) continue
    let key = zeile.slice(0, doppelpunkt)
    const wert = zeile.slice(doppelpunkt + 1)
    const semikolon = key.indexOf(';')
    if (semikolon !== -1) key = key.slice(0, semikolon)
    aktuell[key] = wert
  }

  return events
    .map(ev => {
      const { datum, zeit } = datumZeitAus(ev.DTSTART ?? '')
      return {
        uid: ev.UID ?? `${datum}-${ev.SUMMARY ?? ''}`,
        datum,
        zeit,
        titel: ev.SUMMARY ? textUnescapen(ev.SUMMARY) : null,
        ort: ev.LOCATION ? textUnescapen(ev.LOCATION) : null,
        abgesagt: ev.STATUS === 'CANCELLED',
      }
    })
    .filter(ev => /^\d{4}-\d{2}-\d{2}$/.test(ev.datum))
    .sort((a, b) => a.datum.localeCompare(b.datum))
}
