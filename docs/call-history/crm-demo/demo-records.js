/*
 * Fixed, synthetic Call History examples for one fictional NFON user.
 * Nothing in this file is loaded from NFON, a tenant, a CRM or the current date.
 *
 * API-field provenance (Call History v1): uuid, created, status and the optional
 * direction, transcription.available / transcription.summary and transcript[]
 * fields. Each transcript item uses time (RFC3339), source (caller/callee), event
 * (start/speech/stop), and text for speech. The demo uses the
 * documented status vocabulary: answered, missed, cancelled, unknown. It does
 * not infer that every answered call has a transcription. In this fixed demo,
 * every completed transcription includes a prepared summary.
 *
 * scenarioId and callId below are LOCAL navigation metadata, not NFON fields.
 * They link the three detailed examples to records in the same 125-call cohort.
 * No task, owner, CRM match, revenue or time-saving value is attributed to the
 * API. Three transcripts use the detailed scenarios. All other available
 * transcripts use deliberately generic, synthetic dialogues; there is no
 * transcript detail view for those aggregate fixtures.
 */
'use strict';

window.rebuildDemoRecords = () => {
  const t = (...args) => window.DEMO_I18N.t(...args);
  // The fixed showcase deliberately contains no unknown-status record.
  const dayPlans = [
    { date: '2026-10-05', answered: 15, missed: 2, cancelled: 1, unknown: 0, transcripts: 10 },
    { date: '2026-10-06', answered: 21, missed: 4, cancelled: 1, unknown: 0, transcripts: 16 },
    { date: '2026-10-07', answered: 17, missed: 3, cancelled: 1, unknown: 0, transcripts: 13 },
    { date: '2026-10-08', answered: 23, missed: 4, cancelled: 1, unknown: 0, transcripts: 18 },
    { date: '2026-10-09', answered: 14, missed: 2, cancelled: 1, unknown: 0, transcripts: 9 },
    { date: '2026-10-10', answered: 4, missed: 2, cancelled: 0, unknown: 0, transcripts: 3 },
    { date: '2026-10-11', answered: 8, missed: 1, cancelled: 0, unknown: 0, transcripts: 6 }
  ];
  const caseLinks = [
    { id: 'support', callId: 'DEMO-SUPPORT-001', time: '10:15:00', direction: 'inbound', number: '+498900002101' },
    { id: 'sales', callId: 'DEMO-SALES-002', time: '11:30:00', direction: 'outbound', number: '+498900002102' },
    { id: 'appointment', callId: 'DEMO-APPOINTMENT-003', time: '13:45:00', direction: 'outbound', number: '+498900002103' }
  ];
  const genericDialogues = [
    { topic: t('offene Serviceanfrage'), customer: t('Ich möchte den aktuellen Stand meiner Serviceanfrage besprechen.'), agent: t('Wir haben den bisherigen Stand besprochen. Die weitere Bearbeitung ist noch offen.'), summary: t('Beispielgespräch zu einer offenen Serviceanfrage. Der aktuelle Stand wurde besprochen; die weitere Bearbeitung ist noch offen.') },
    { topic: t('Telefonieangebot'), customer: t('Ich möchte den Bedarf für ein Telefonieangebot erläutern.'), agent: t('Der Bedarf ist erläutert. Die Einzelheiten klären wir in einem weiteren Gespräch.'), summary: t('Beispielgespräch zu einem Telefonieangebot. Der Bedarf wurde erläutert; die Einzelheiten werden in einem weiteren Gespräch geklärt.') },
    { topic: t('geplante Einrichtung'), customer: t('Ich möchte den gewünschten Umfang einer geplanten Einrichtung besprechen.'), agent: t('Der Umfang ist besprochen. Zusätzliche Änderungen wurden nicht vereinbart.'), summary: t('Beispielgespräch zu einer geplanten Einrichtung. Der gewünschte Umfang wurde besprochen; zusätzliche Änderungen wurden nicht vereinbart.') },
    { topic: t('Rückfrage'), customer: t('Ich möchte zu meiner Rückfrage die vorhandenen Angaben abgleichen.'), agent: t('Die vorhandenen Angaben sind abgeglichen. Ich fasse das Gespräch als Notiz zusammen.'), summary: t('Beispielgespräch zu einer Rückfrage. Die vorhandenen Angaben wurden abgeglichen und als Gesprächsnotiz zusammengefasst.') }
  ];
  const statuses = ['answered', 'missed', 'cancelled', 'unknown'];
  const records = [];

  function transcriptItems(created, direction, turns, duration) {
    const start = Date.parse(created);
    const seconds = value => value.split(':').reduce((total, part) => total * 60 + Number(part), 0);
    const items = [{ time: new Date(start).toISOString(), source: 'caller', event: 'start' }];
    turns.forEach(turn => {
      const customerIsCaller = direction === 'inbound';
      const isCaller = turn.role === 'customer' ? customerIsCaller : !customerIsCaller;
      items.push({ time: new Date(start + seconds(turn.time) * 1000).toISOString(), source: isCaller ? 'caller' : 'callee', event: 'speech', text: turn.text });
    });
    items.push({ time: new Date(start + seconds(duration) * 1000).toISOString(), source: 'caller', event: 'stop' });
    return Object.freeze(items.map(item => Object.freeze(item)));
  }

  dayPlans.forEach((plan, dayIndex) => {
    let position = 0;
    statuses.forEach(status => {
      for (let index = 0; index < plan[status]; index += 1) {
        const ordinal = records.length + 1;
        const minute = 8 * 60 + 5 + position * 18 + dayIndex * 3;
        const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;
        const hasTranscript = status === 'answered' && index < plan.transcripts;
        const link = dayIndex === 4 && status === 'answered' ? caseLinks[index] : null;
        const scenario = link && (window.TRANSCRIPT_SCENARIOS || []).find(item => item.id === link.id);
        const direction = link?.direction || (ordinal % 3 === 0 ? 'outbound' : 'inbound');
        const created = `${plan.date}T${link ? link.time : time}+02:00`;
        const transcription = { available: hasTranscript };
        if (hasTranscript) {
          const dialogue = genericDialogues[ordinal % genericDialogues.length];
          const genericTurns = [
            { time: '00:00', role: 'agent', text: t('Guten Tag, Lena Bergmann. Es geht um das Thema {topic}.', { topic: dialogue.topic }) },
            { time: '00:15', role: 'customer', text: dialogue.customer },
            { time: '01:00', role: 'agent', text: dialogue.agent },
            { time: '01:35', role: 'customer', text: t('Vielen Dank für das Gespräch. Auf Wiederhören.') }
          ];
          transcription.transcript = transcriptItems(created, direction, scenario?.turns || genericTurns, scenario?.duration || '02:00');
          // All completed demo transcripts include their prepared summary.
          transcription.summary = scenario?.fields?.summary?.value || dialogue.summary;
        }
        const record = {
          uuid: `de000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`,
          created,
          status,
          direction,
          transcription: Object.freeze(transcription)
        };
        if (link) {
          record.scenarioId = link.id;
          record.callId = scenario?.callId || link.callId;
          const localNumber = '+498900001000';
          record.caller = Object.freeze({ number: (direction === 'inbound' ? link.number : localNumber).slice(1), context: 'global' });
          record.callee = Object.freeze({ number: (direction === 'outbound' ? link.number : localNumber).slice(1), context: 'global' });
        }
        records.push(Object.freeze(record));
        position += 1;
      }
    });
  });
  records.sort((left, right) => Date.parse(left.created) - Date.parse(right.created));
  window.DEMO_RECORDS = Object.freeze(records);
  window.DEMO_DATA_INFO = Object.freeze({
    timeZone: 'Europe/Berlin',
    userScope: t('Ein Demo-Nutzer'),
    dates: Object.freeze(dayPlans.map(plan => plan.date)),
    synthetic: true,
    recordDetailsComplete: true
  });
};
window.rebuildDemoRecords();
