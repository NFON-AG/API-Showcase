/*
 * Synthetic conversations for the local prototype.
 * Summaries are prepared API examples. No conversation, company, contact or
 * CRM record is a live record. Prepared CRM follow-ups live in automation.js,
 * outside the API-shaped records; they are not native Call History fields.
 * sourceIds reference the exact transcript turns supporting each example.
 */
window.TRANSCRIPT_SCENARIOS = [
  {
    id: 'support',
    category: 'Support',
    title: 'PDF-Export prüfen',
    customer: 'Lindenwerk GmbH',
    contact: 'Mara Fink',
    agent: 'Lena Bergmann',
    date: '09.10.2026',
    time: '10:15',
    duration: '03:42',
    callId: 'DEMO-SUPPORT-001',
    turns: [
      { id: 's1', time: '00:00', speaker: 'Lena Bergmann', role: 'agent', text: 'Guten Tag, hier ist Lena Bergmann vom Support. Mit wem spreche ich?' },
      { id: 's2', time: '00:12', speaker: 'Mara Fink', role: 'customer', text: 'Mara Fink von der Lindenwerk GmbH. Seit dem letzten Update unserer Warenwirtschaft lässt sich der Monatsbericht nicht mehr als PDF exportieren. Die Ladeanzeige läuft einfach weiter.' },
      { id: 's3', time: '00:37', speaker: 'Lena Bergmann', role: 'agent', text: 'Tritt das bei mehreren Benutzerkonten auf? Und funktioniert der Export in anderen Formaten, zum Beispiel als CSV?' },
      { id: 's4', time: '00:52', speaker: 'Mara Fink', role: 'customer', text: 'Wir haben es mit zwei Benutzerkonten versucht, beide Male bleibt der PDF-Export hängen. Als CSV lässt sich derselbe Monatsbericht problemlos herunterladen.' },
      { id: 's5', time: '01:20', speaker: 'Lena Bergmann', role: 'agent', text: 'Dann prüfe ich die Exportprotokolle für diesen Bericht. Welche Version ist installiert? Ein Screenshot der Ladeanzeige wäre ebenfalls hilfreich.' },
      { id: 's6', time: '01:49', speaker: 'Mara Fink', role: 'customer', text: 'Wir nutzen seit gestern Version 6.4. Die Versionsangabe und einen Screenshot habe ich bereits an den Support geschickt.' },
      { id: 's7', time: '02:10', speaker: 'Lena Bergmann', role: 'agent', text: 'Danke. Ich, Lena Bergmann, übernehme die Prüfung und den Rückruf selbst. Ich melde mich am Montag, den 12. Oktober 2026, bis 15 Uhr bei Ihnen mit dem Stand.' },
      { id: 's8', time: '02:47', speaker: 'Mara Fink', role: 'customer', text: 'Der Rückruf am 12. Oktober bis 15 Uhr passt. Bitte melden Sie sich auch dann, wenn die Ursache bis dahin noch nicht feststeht.' },
      { id: 's9', time: '03:09', speaker: 'Lena Bergmann', role: 'agent', text: 'Ja, zugesagt. Ich prüfe die Exportprotokolle und gebe Ihnen bis zu diesem Termin eine Rückmeldung, auch bei noch offener Ursache.' },
      { id: 's10', time: '03:31', speaker: 'Mara Fink', role: 'customer', text: 'Vielen Dank, dann warte ich auf Ihre Rückmeldung. Auf Wiederhören.' }
    ],
    fields: {
      summary: { value: 'Seit dem Update der Warenwirtschaft auf Version 6.4 bleibt der PDF-Export des Monatsberichts bei zwei Benutzerkonten hängen. Der CSV-Export funktioniert. Versionsangabe und Screenshot liegen laut Kundin beim Support. Lena Bergmann prüft die Exportprotokolle und meldet sich am 12. Oktober bis 15 Uhr zurück; die Ursache ist noch offen.', sourceIds: ['s2', 's4', 's5', 's6', 's7', 's8', 's9'] },
    }
  },
  {
    id: 'sales',
    category: 'Vertrieb',
    title: 'Angebot konkretisieren',
    customer: 'Hafenblick Studio',
    contact: 'Noah Winter',
    agent: 'Lena Bergmann',
    date: '09.10.2026',
    time: '11:30',
    duration: '04:05',
    callId: 'DEMO-SALES-002',
    turns: [
      { id: 'v1', time: '00:00', speaker: 'Lena Bergmann', role: 'agent', text: 'Guten Tag Herr Winter, hier ist Lena Bergmann. Ich melde mich zum Telefonieangebot für das Hafenblick Studio. Welche Punkte sind noch offen?' },
      { id: 'v2', time: '00:19', speaker: 'Noah Winter', role: 'customer', text: 'Wir planen mit zwölf Arbeitsplätzen. Wichtig sind uns Gesprächsnotizen im CRM. Können Transkripte dafür genutzt werden?' },
      { id: 'v3', time: '00:48', speaker: 'Lena Bergmann', role: 'agent', text: 'Das würden wir gern anhand eines Beispielgesprächs demonstrieren. Welches CRM-System eingesetzt wird und welche Anbindung möglich ist, müssen wir vorher noch klären.' },
      { id: 'v4', time: '01:13', speaker: 'Noah Winter', role: 'customer', text: 'Den Namen unseres CRM-Systems reiche ich nach. Bitte schicken Sie zunächst ein aktualisiertes Angebot für zwölf Arbeitsplätze und einen Vorschlag für eine Transkript-Demo.' },
      { id: 'v5', time: '01:43', speaker: 'Lena Bergmann', role: 'agent', text: 'Ich, Lena Bergmann, übernehme beides: das aktualisierte Angebot und den Vorschlag für die Demo. Die CRM-Anbindung bleibt darin als offener Klärungspunkt stehen.' },
      { id: 'v6', time: '02:08', speaker: 'Noah Winter', role: 'customer', text: 'Ja, bitte keine bestehende Anbindung voraussetzen. Wir möchten erst sehen, welche Gesprächsinhalte in eine Notiz übernommen werden könnten.' },
      { id: 'v7', time: '02:33', speaker: 'Lena Bergmann', role: 'agent', text: 'Bis wann wird das aktualisierte Angebot benötigt?' },
      { id: 'v8', time: '02:44', speaker: 'Noah Winter', role: 'customer', text: 'Das kann ich heute noch nicht festlegen. Unsere interne Abstimmung steht aus. Bitte stimmen Sie den Termin separat mit mir ab.' },
      { id: 'v9', time: '03:11', speaker: 'Lena Bergmann', role: 'agent', text: 'Verstanden, dann ist noch kein Liefertermin vereinbart. Ich bereite Angebot und Demo-Vorschlag vor und kläre den Termin separat mit Ihnen.' },
      { id: 'v10', time: '03:52', speaker: 'Noah Winter', role: 'customer', text: 'So machen wir es. Vielen Dank für das Gespräch.' }
    ],
    fields: {
      summary: { value: 'Das Hafenblick Studio plant zwölf Arbeitsplätze und möchte Gesprächsinhalte für CRM-Notizen nutzen. Gewünscht sind ein aktualisiertes Angebot und ein Vorschlag für eine Transkript-Demo. CRM-System und mögliche Anbindung sind noch zu klären. Ein Liefertermin wurde nicht vereinbart.', sourceIds: ['v1', 'v2', 'v3', 'v4', 'v6', 'v8', 'v9'] },
    }
  },
  {
    id: 'appointment',
    category: 'Termin',
    title: 'Einrichtungstermin vereinbaren',
    customer: 'Bergtal Praxis',
    contact: 'Lea Sommer',
    agent: 'Lena Bergmann',
    date: '09.10.2026',
    time: '13:45',
    duration: '02:58',
    callId: 'DEMO-APPOINTMENT-003',
    turns: [
      { id: 't1', time: '00:00', speaker: 'Lena Bergmann', role: 'agent', text: 'Guten Tag, Lena Bergmann vom Einrichtungsteam. Ich rufe wegen eines Termins für die Bergtal Praxis an.' },
      { id: 't2', time: '00:15', speaker: 'Lea Sommer', role: 'customer', text: 'Guten Tag, hier ist Lea Sommer. Wir möchten die Rufgruppe für den Empfang gemeinsam einrichten und danach die Erreichbarkeit testen.' },
      { id: 't3', time: '00:37', speaker: 'Lena Bergmann', role: 'agent', text: 'Dafür schlage ich Dienstag, den 13. Oktober 2026, um 10 Uhr vor. Der gemeinsame Online-Termin dauert voraussichtlich 30 Minuten.' },
      { id: 't4', time: '00:59', speaker: 'Lea Sommer', role: 'customer', text: 'Der 13. Oktober um 10 Uhr passt. Ich nehme teil; für die 30 Minuten ist auch ein Testtelefon am Empfang verfügbar.' },
      { id: 't5', time: '01:20', speaker: 'Lena Bergmann', role: 'agent', text: 'Ich, Lena Bergmann, führe den Termin selbst durch. Wir richten die Empfangs-Rufgruppe ein und prüfen anschließend mit Testanrufen die Erreichbarkeit.' },
      { id: 't6', time: '01:43', speaker: 'Lea Sommer', role: 'customer', text: 'Bitte währenddessen keine weiteren Rufgruppen verändern. Es geht zunächst nur um den Empfang.' },
      { id: 't7', time: '01:57', speaker: 'Lena Bergmann', role: 'agent', text: 'Einverstanden, der Umfang bleibt auf die Rufgruppe am Empfang und die vereinbarten Testanrufe begrenzt. Ich schicke im Anschluss eine Termineinladung.' },
      { id: 't8', time: '02:20', speaker: 'Lea Sommer', role: 'customer', text: 'Danke. Dann halten wir Dienstag, 13. Oktober 2026, von 10 bis 10:30 Uhr als Online-Termin fest.' },
      { id: 't9', time: '02:38', speaker: 'Lena Bergmann', role: 'agent', text: 'Genau, so ist der Termin vereinbart. Vielen Dank und auf Wiederhören.' },
      { id: 't10', time: '02:50', speaker: 'Lea Sommer', role: 'customer', text: 'Auf Wiederhören.' }
    ],
    fields: {
      summary: { value: 'Lea Sommer bestätigt einen 30-minütigen Online-Termin für die Bergtal Praxis am 13. Oktober 2026 um 10 Uhr. Ein Testtelefon am Empfang steht bereit. Vereinbart sind die Einrichtung der Empfangs-Rufgruppe und Testanrufe; andere Rufgruppen bleiben außerhalb des Umfangs.', sourceIds: ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'] },
    }
  }
];

// Each prepared locale preserves the same identities, timings and source turns.
(() => {
  const de = window.TRANSCRIPT_SCENARIOS;
  window.TRANSCRIPT_SCENARIOS_BY_LANGUAGE = Object.fromEntries(window.DEMO_I18N.languages.map(language => {
    if (language === 'de') return [language, de];
    const translations = window.CRM_DEMO_LOCALES[language].scenarios;
    return [language, de.map(scenario => {
      const translation = translations[scenario.id];
      return { ...scenario, category: translation.category, title: translation.title,
        turns: scenario.turns.map((turn, index) => ({ ...turn, text: translation.turns[index] })),
        fields: { summary: { ...scenario.fields.summary, value: translation.summary } }
      };
    })];
  }));
  window.TRANSCRIPT_SCENARIOS = window.TRANSCRIPT_SCENARIOS_BY_LANGUAGE[window.DEMO_I18N.lang];
})();
