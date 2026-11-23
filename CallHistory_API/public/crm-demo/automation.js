'use strict';

(() => {
  // Separate synthetic CRM directory: names/company are CRM data, not extracted
  // from the transcript. These examples use unambiguous international numbers.
  const contacts = Object.freeze([
    Object.freeze({ id: 'CRM-101', number: '+498900002101', name: 'Mara Fink', company: 'Lindenwerk GmbH' }),
    Object.freeze({ id: 'CRM-102', number: '+498900002102', name: 'Noah Winter', company: 'Hafenblick Studio' }),
    Object.freeze({ id: 'CRM-103', number: '+498900002103', name: 'Lea Sommer', company: 'Bergtal Praxis' })
  ]);
  const numberKey = value => String(value || '').replace(/^\+|^00/, '').replace(/[ ()-]/g, '');

  function followUpFor(call) {
    // Prepared output of the consuming CRM workflow, not Call History API fields.
    // Calendar details are agreed in the transcript. The sales reminder uses an
    // internal rule (next business day, 09:00 Berlin), not a customer deadline.
    const scenario = window.TRANSCRIPT_SCENARIOS.find(item => item.id === call.scenarioId);
    const common = { sourceCallUuid: call.uuid, timeZone: 'Europe/Berlin', owner: scenario.agent };
    if (call.scenarioId === 'appointment') return Object.freeze({
      ...common, id: `CAL-${call.uuid}`, kind: 'calendar', basis: 'transcript',
      title: window.DEMO_I18N.t('Empfangs-Rufgruppe einrichten'),
      startsAt: '2026-10-13T10:00:00+02:00', endsAt: '2026-10-13T10:30:00+02:00',
      location: 'Online', attendee: call.contact.name, invitationStatus: 'prepared',
      sourceTurnIds: Object.freeze(['t2', 't3', 't4', 't5', 't8'])
    });
    if (call.scenarioId === 'support') return Object.freeze({
      ...common, id: `REM-${call.uuid}`, kind: 'reminder', basis: 'transcript',
      title: scenario.title, dueAt: '2026-10-12T14:30:00+02:00', deadlineAt: '2026-10-12T15:00:00+02:00',
      sourceTurnIds: Object.freeze(['s7', 's8', 's9'])
    });
    if (call.scenarioId === 'sales') return Object.freeze({
      ...common, id: `REM-${call.uuid}`, kind: 'reminder', basis: 'next-business-day',
      title: window.DEMO_I18N.t('Angebot und Demo-Vorschlag nachfassen'),
      // The fixed call occurs on Friday, 9 October 2026.
      dueAt: '2026-10-12T09:00:00+02:00',
      sourceTurnIds: Object.freeze(['v4', 'v5', 'v8', 'v9'])
    });
    return null;
  }

  function lookupCall(scenarioId) {
    const record = window.DEMO_RECORDS.find(item => item.scenarioId === scenarioId);
    if (!record || record.status !== 'answered' || record.transcription?.available !== true) return null;
    const { summary, transcript } = record.transcription;
    if (typeof summary !== 'string' || !summary.trim() || !Array.isArray(transcript) || !transcript.some(item => item.event === 'speech' && item.text)) return null;
    const remote = record.direction === 'inbound' ? record.caller : record.direction === 'outbound' ? record.callee : null;
    if (remote?.context !== 'global') return null;
    const contact = contacts.find(item => numberKey(item.number) === numberKey(remote?.number));
    if (!contact) return null;
    const start = transcript.find(item => item.event === 'start');
    const stop = transcript.findLast(item => item.event === 'stop');
    const duration = (Date.parse(stop?.time) - Date.parse(start?.time)) / 1000;
    if (!Number.isFinite(duration) || duration < 0) return null;
    return Object.freeze({
      uuid: record.uuid, callId: record.callId, scenarioId: record.scenarioId,
      created: record.created, direction: record.direction, duration,
      phoneNumber: `+${numberKey(remote.number)}`,
      contact: Object.freeze({ id: contact.id, name: contact.name, company: contact.company }),
      summary, transcript
    });
  }

  function createStore() {
    const entries = new Map();
    return Object.freeze({
      upsert(call) {
        // Only a current fixed fixture can create an activity. Replays and
        // language changes update the same UUID instead of creating duplicates.
        const canonical = call && lookupCall(call.scenarioId);
        if (!canonical || canonical.uuid !== call.uuid) throw new TypeError('No completed demo call for this activity');
        const entry = Object.freeze({ ...canonical, id: `ACT-${canonical.uuid}`, followUp: followUpFor(canonical) });
        entries.set(entry.uuid, entry);
        return entry;
      },
      get(uuid) { return entries.get(uuid) || null; },
      get size() { return entries.size; }
    });
  }

  window.DEMO_AUTOMATION = Object.freeze({ lookupCall, createStore });
})();
