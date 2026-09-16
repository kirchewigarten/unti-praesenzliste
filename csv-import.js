// Flexibler CSV-Import für Personen: pickt sich aus beliebigen Spaltenkombinationen nur das
// heraus, was das Datenmodell kennt (Vorname, Nachname, Geburtstag, Klasse) — andere Spalten
// (Adresse, E-Mail, AHV-Nummer, …) werden ignoriert, egal ob und wo sie in der Datei vorkommen.

const SPALTEN_ALIASE = {
  vorname: ['vorname', 'firstname', 'first name'],
  nachname: ['nachname', 'name', 'lastname', 'last name', 'surname'],
  geburtstag: ['geburtsdatum', 'geburtstag', 'birthdate', 'birthday'],
  klasse: ['klasse', 'class', 'stufe'],
}

function normalisiereHeader(wert) {
  return wert.trim().toLowerCase()
}

function findeSpalte(headerZeile, aliase) {
  const normalisiert = headerZeile.map(normalisiereHeader)
  for (const alias of aliase) {
    const index = normalisiert.indexOf(alias)
    if (index !== -1) return index
  }
  return -1
}

// RFC-4180-artiges CSV-Parsing (Anführungszeichen mit eingebetteten Kommas/Zeilenumbrüchen,
// "" als escapetes Anführungszeichen) — die Exporte enthalten z.B. mehrere E-Mail-Adressen
// kommagetrennt in einem einzelnen, gequoteten Feld.
function parseCsvZeilen(text) {
  const bereinigt = text.replace(/^﻿/, '').replace(/\r\n/g, '\n')
  const zeilen = []
  let zeile = []
  let feld = ''
  let inAnfuehrungszeichen = false

  for (let i = 0; i < bereinigt.length; i++) {
    const zeichen = bereinigt[i]
    if (inAnfuehrungszeichen) {
      if (zeichen === '"') {
        if (bereinigt[i + 1] === '"') {
          feld += '"'
          i++
        } else {
          inAnfuehrungszeichen = false
        }
      } else {
        feld += zeichen
      }
    } else if (zeichen === '"') {
      inAnfuehrungszeichen = true
    } else if (zeichen === ',') {
      zeile.push(feld)
      feld = ''
    } else if (zeichen === '\n') {
      zeile.push(feld)
      zeilen.push(zeile)
      zeile = []
      feld = ''
    } else {
      feld += zeichen
    }
  }
  if (feld !== '' || zeile.length > 0) {
    zeile.push(feld)
    zeilen.push(zeile)
  }
  return zeilen.filter(z => z.some(f => f.trim() !== ''))
}

// "30.05.2012" (Schweizer Format, wie es die CSV-Exporte liefern) → "2012-05-30" (ISO, wie es
// das Datenmodell und das <input type="date"> erwarten).
function geburtstagZuIso(wert) {
  const treffer = wert.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (!treffer) return null
  const [, tag, monat, jahr] = treffer
  return `${jahr}-${monat.padStart(2, '0')}-${tag.padStart(2, '0')}`
}

function normalisiereKlasse(wert) {
  const treffer = wert.match(/^([123])/)
  return treffer ? treffer[1] : null
}

export function personenAusCsv(text) {
  const zeilen = parseCsvZeilen(text)
  if (zeilen.length < 2) return []
  const [headerZeile, ...datenZeilen] = zeilen

  const spalten = {
    vorname: findeSpalte(headerZeile, SPALTEN_ALIASE.vorname),
    nachname: findeSpalte(headerZeile, SPALTEN_ALIASE.nachname),
    geburtstag: findeSpalte(headerZeile, SPALTEN_ALIASE.geburtstag),
    klasse: findeSpalte(headerZeile, SPALTEN_ALIASE.klasse),
  }
  if (spalten.vorname === -1 || spalten.nachname === -1) {
    throw new Error('Die CSV-Datei enthält keine erkennbaren Spalten für Vorname und Nachname.')
  }

  return datenZeilen
    .map(zeile => {
      const geburtstagRoh = spalten.geburtstag !== -1 ? (zeile[spalten.geburtstag] ?? '').trim() : ''
      const klasseRoh = spalten.klasse !== -1 ? (zeile[spalten.klasse] ?? '').trim() : ''
      return {
        vorname: (zeile[spalten.vorname] ?? '').trim(),
        nachname: (zeile[spalten.nachname] ?? '').trim(),
        geburtstag: geburtstagZuIso(geburtstagRoh),
        klasse: normalisiereKlasse(klasseRoh),
      }
    })
    .filter(p => p.vorname && p.nachname)
}
