'use strict';

(() => {
  const t = (...args) => window.DEMO_I18N.t(...args);
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const store = window.DEMO_AUTOMATION.createStore();
  let scenarios = window.TRANSCRIPT_SCENARIOS;
  let selectedId = scenarios[0].id;
  let mainView = location.hash === '#auswertung' ? 'analytics' : 'examples';
  let timer = null;
  // Embedded playback starts only after the validated parent visibility handshake.
  let embeddedActive = window.parent === window;
  let generation = 0;
  let casesLanguage = null;
  const runs = new Map(scenarios.map(scenario => [scenario.id, { completed: 0, transcriptOpen: false }]));
  const current = () => scenarios.find(scenario => scenario.id === selectedId);
  const currentRun = () => runs.get(selectedId);
  const currentCall = () => window.DEMO_AUTOMATION.lookupCall(selectedId);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const formatDate = value => new Intl.DateTimeFormat(window.DEMO_I18N.locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(value));
  const formatDuration = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const relativeTime = (time, created) => formatDuration(Math.max(0, Math.round((Date.parse(time) - Date.parse(created)) / 1000)));

  function cancelRun() {
    generation += 1;
    clearTimeout(timer);
    timer = null;
  }

  function renderCases() {
    // Preserve keyboard focus while the timed workflow updates status labels.
    if (casesLanguage !== window.DEMO_I18N.lang) {
      $('case-list').innerHTML = scenarios.map(scenario => `<button type="button" class="case-button" data-case="${escape(scenario.id)}" aria-label="${escape(scenario.category + ': ' + scenario.title)}"><span class="case-category">${escape(scenario.category)}</span><span class="case-title">${escape(scenario.title)}</span><span class="case-customer">${escape(scenario.customer)}</span><span class="pill case-badge"></span></button>`).join('');
      casesLanguage = window.DEMO_I18N.lang;
    }
    scenarios.forEach(scenario => {
      const completed = runs.get(scenario.id).completed;
      const button = document.querySelector(`[data-case="${scenario.id}"]`);
      button.setAttribute('aria-current', String(scenario.id === selectedId));
      const badge = button.querySelector('.case-badge');
      badge.textContent = completed === 4 ? t('Im CRM') : completed ? t('In Bearbeitung') : t('Bereit');
      badge.className = 'pill case-badge ' + (completed === 4 ? 'green' : completed ? 'purple' : 'neutral');
    });
  }

  function setBadge(id, label, tone) {
    $(id).textContent = label;
    $(id).className = 'pill ' + tone;
  }

  function renderWorkflow() {
    const completed = currentRun().completed;
    const finalStep = selectedId === 'appointment'
      ? [t('CRM-Notiz & Termin anlegen'), t('CRM-Notiz & Termin angelegt')]
      : ['sales', 'support'].includes(selectedId)
        ? [t('CRM-Notiz & Erinnerung anlegen'), t('CRM-Notiz & Erinnerung angelegt')]
        : [t('CRM-Notiz automatisch anlegen'), t('CRM-Notiz angelegt')];
    const steps = [
      [t('Gespräch beendet'), t('Gespräch beendet')],
      [t('Transkript & Zusammenfassung abrufen'), t('Transkript & Zusammenfassung abgerufen')],
      [t('Kontakt anhand Rufnummer zuordnen'), t('Kontakt zugeordnet')],
      finalStep
    ];
    $('automation-flow').innerHTML = steps.map(([pending, done], index) => {
      const complete = index < completed;
      const active = index === completed;
      return `<li class="${complete ? 'complete' : active ? 'current' : ''}"${active ? ' aria-current="step"' : ''}><span class="step-number" aria-hidden="true">${complete ? '✓' : index + 1}</span><span>${complete ? done : pending}</span></li>`;
    }).join('');
  }

  function transcriptMarkup(call) {
    return call.transcript.filter(item => item.event === 'speech').map(item => {
      const customerIsCaller = call.direction === 'inbound';
      const customer = (item.source === 'caller') === customerIsCaller;
      const speaker = customer ? call.contact.name : current().agent;
      return `<article class="turn"><div class="turn-meta"><span class="speaker">${escape(speaker)}</span><span class="turn-time">${relativeTime(item.time, call.created)}</span></div><p>${escape(item.text)}</p></article>`;
    }).join('');
  }

  function renderApi(call) {
    const available = currentRun().completed >= 2;
    setBadge('api-status', available ? t('Abgerufen') : t('Wird abgerufen'), available ? 'green' : 'purple');
    if (!available) {
      $('api-content').innerHTML = `<div class="waiting-state"><span class="progress-mark" aria-hidden="true"></span><p>${t('Transkript und Zusammenfassung werden abgerufen.')}</p></div>`;
      return;
    }
    $('api-content').innerHTML = `<section class="api-summary"><h3>${t('Zusammenfassung')}</h3><p>${escape(call.summary)}</p></section><section class="api-transcript"><h3>${t('Transkript')}</h3><div class="transcript-scroll" tabindex="0" role="region" aria-label="${escape(t('Vollständiges Transkript'))}">${transcriptMarkup(call)}</div></section>`;
  }

  function contactMarkup(call) {
    return `<div class="crm-contact"><span class="contact-avatar" aria-hidden="true">${escape(call.contact.name.split(/\s+/).map(part => part[0]).slice(0, 2).join(''))}</span><div><h3>${escape(call.contact.name)}</h3><p class="caption">${escape(call.contact.company)}</p></div></div>`;
  }

  function followUpMarkup(followUp) {
    if (!followUp) return '';
    const calendar = followUp.kind === 'calendar';
    const start = new Date(calendar ? followUp.startsAt : followUp.dueAt);
    const format = options => new Intl.DateTimeFormat(window.DEMO_I18N.locale, { ...options, timeZone: followUp.timeZone });
    const time = format({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const hours = calendar ? `${time.format(start)}–${time.format(new Date(followUp.endsAt))}` : time.format(start);
    const date = format({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(start);
    const month = format({ month: 'short' }).format(start);
    const day = format({ day: 'numeric' }).format(start);
    return `<section class="follow-up-card" data-follow-up-id="${escape(followUp.id)}" data-follow-up-kind="${escape(followUp.kind)}" aria-labelledby="follow-up-title"><div class="follow-up-heading"><div class="follow-up-date-tile" aria-hidden="true"><span>${escape(month)}</span><span class="follow-up-day">${escape(day)}</span></div><div class="follow-up-title"><p class="follow-up-kind">${calendar ? t('Kalendereintrag') : t('CRM-Erinnerung')}</p><h3 id="follow-up-title">${escape(followUp.title)}</h3></div></div><p class="follow-up-date"><time datetime="${escape(calendar ? followUp.startsAt : followUp.dueAt)}">${escape(date)}</time></p><p class="follow-up-time">${escape(hours)} <span class="caption">· ${escape(followUp.timeZone)}</span></p>${calendar ? `<p class="follow-up-rule">${t('Einladung vorbereitet')}</p>` : `<p class="follow-up-rule">${t(followUp.basis === 'transcript' ? 'Erinnerung 30 Minuten vor Rückruffrist' : 'Nächster Werktag · CRM-Regel')}</p>`}<dl class="follow-up-meta"><div><dt>${t('Zuständig')}</dt><dd>${escape(followUp.owner)}</dd></div>${calendar ? `<div><dt>${t('Teilnahme')}</dt><dd>${escape(followUp.attendee)}</dd></div><div><dt>${t('Ort')}</dt><dd>${escape(t(followUp.location))}</dd></div>` : ''}</dl></section>`;
  }

  function renderCrm(call) {
    const completed = currentRun().completed;
    const entry = completed === 4 ? store.get(call.uuid) : null;
    setBadge('crm-status', entry ? t('Automatisch angelegt') : completed >= 3 ? t('Kontakt gefunden') : t('Ausstehend'), entry ? 'green' : completed >= 3 ? 'purple' : 'neutral');
    if (!entry) {
      $('crm-content').innerHTML = `${completed >= 3 ? contactMarkup(call) : ''}<div class="waiting-state"><span class="progress-mark" aria-hidden="true"></span><p>${completed >= 3 ? t('Gesprächsnotiz wird angelegt.') : t('Kontaktabgleich wartet auf Gesprächsdaten.')}</p></div>`;
      return;
    }
    $('crm-content').innerHTML = `${contactMarkup(entry)}${followUpMarkup(entry.followUp)}<dl class="activity-facts"><div><dt>${t('Anruf')}</dt><dd>${escape(formatDate(entry.created))}</dd></div><div><dt>${t('Rufnummer')}</dt><dd>${escape(entry.phoneNumber)}</dd></div></dl><section class="activity-summary"><h3>${t('Gesprächsnotiz')}</h3><p>${escape(entry.summary)}</p></section><details class="crm-transcript"${currentRun().transcriptOpen ? ' open' : ''}><summary>${t('Vollständiges Transkript')}</summary><div class="transcript-scroll" tabindex="0" role="region" aria-label="${escape(t('Transkript im CRM'))}">${transcriptMarkup(entry)}</div></details>`;
    const scenarioId = selectedId;
    $('crm-content').querySelector('details').addEventListener('toggle', event => {
      runs.get(scenarioId).transcriptOpen = event.currentTarget.open;
    });
  }

  function renderCase() {
    const scenario = current();
    const call = currentCall();
    $('case-customer').textContent = scenario.customer;
    $('case-heading').textContent = scenario.title;
    $('case-meta').textContent = `${formatDate(call.created)} · ${call.phoneNumber}`;
    renderCases();
    renderWorkflow();
    renderApi(call);
    renderCrm(call);
  }

  function completeRun() {
    const call = currentCall();
    const entry = store.upsert(call); // Stable API UUID makes repeated delivery update one activity.
    currentRun().completed = 4;
    renderCase();
    const announcement = entry.followUp?.kind === 'calendar'
      ? t('CRM-Gesprächsnotiz und Termin für {contact} angelegt.', { contact: call.contact.name })
      : entry.followUp?.kind === 'reminder'
        ? t('CRM-Gesprächsnotiz und Erinnerung für {contact} angelegt.', { contact: call.contact.name })
        : t('CRM-Gesprächsnotiz für {contact} angelegt.', { contact: call.contact.name });
    $('automation-announcement').textContent = announcement;
  }

  function resumeRun() {
    cancelRun();
    if (mainView !== 'examples' || !embeddedActive || document.hidden) return;
    if (currentRun().completed === 4) { renderCase(); return; }
    const runId = generation;
    const caseId = selectedId;
    if (currentRun().completed === 0) {
      currentRun().completed = 1;
      $('automation-announcement').textContent = t('Automatischer Ablauf gestartet.');
    }
    if (reducedMotion.matches) { completeRun(); return; }
    renderCase();
    const advance = () => {
      if (generation !== runId || selectedId !== caseId || mainView !== 'examples') return;
      if (currentRun().completed === 3) { timer = null; completeRun(); return; }
      currentRun().completed += 1;
      renderCase();
      timer = setTimeout(advance, 850);
    };
    timer = setTimeout(advance, 850);
  }

  function setMainView(view, focus = false) {
    cancelRun();
    mainView = view;
    ['examples', 'analytics'].forEach(name => {
      $('view-' + name).setAttribute('aria-selected', String(name === view));
      $('view-' + name).tabIndex = name === view ? 0 : -1;
    });
    $('workspace').hidden = view !== 'examples';
    $('analytics-view').hidden = view !== 'analytics';
    if (view === 'analytics') window.renderDemoAnalytics();
    else resumeRun();
    if (focus) $('view-' + view).focus();
  }

  function refreshLanguage() {
    cancelRun();
    scenarios = window.TRANSCRIPT_SCENARIOS_BY_LANGUAGE[window.DEMO_I18N.lang];
    window.TRANSCRIPT_SCENARIOS = scenarios;
    window.rebuildDemoRecords();
    // Refresh only existing activities from the same immutable-language fixtures.
    // This cannot add duplicates or complete a not-yet-delivered scenario.
    scenarios.forEach(scenario => {
      const call = window.DEMO_AUTOMATION.lookupCall(scenario.id);
      if (store.get(call.uuid)) store.upsert(call);
    });
    $('automation-announcement').textContent = '';
    if (mainView === 'analytics') window.renderDemoAnalytics();
    else resumeRun();
  }

  $('case-list').addEventListener('click', event => {
    const button = event.target.closest('[data-case]');
    if (!button || button.dataset.case === selectedId) return;
    cancelRun();
    selectedId = button.dataset.case;
    resumeRun();
    document.querySelector(`[data-case="${selectedId}"]`).focus({ preventScroll: true });
  });
  $('replay-flow').addEventListener('click', () => {
    cancelRun();
    currentRun().completed = 0;
    resumeRun();
  });
  ['examples', 'analytics'].forEach(view => {
    $('view-' + view).addEventListener('click', () => {
      history.replaceState(null, '', view === 'analytics' ? '#auswertung' : '#beispiele');
      setMainView(view);
    });
    $('view-' + view).addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'examples' : event.key === 'End' ? 'analytics' : mainView === 'examples' ? 'analytics' : 'examples';
      history.replaceState(null, '', next === 'analytics' ? '#auswertung' : '#beispiele');
      setMainView(next, true);
    });
  });
  $('capabilities-open').addEventListener('click', () => {
    const dialog = $('capabilities-dialog');
    const top = Math.max(16, $('capabilities-open').getBoundingClientRect().bottom + 12);
    dialog.style.top = top + 'px';
    dialog.style.maxHeight = Math.max(180, Math.min(500, window.innerHeight - top - 24)) + 'px';
    dialog.showModal();
    $('capabilities-close').focus();
  });
  $('capabilities-close').addEventListener('click', () => $('capabilities-dialog').close());
  $('capabilities-dialog').addEventListener('close', () => $('capabilities-open').focus());
  $('capabilities-dialog').addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...$('capabilities-dialog').querySelectorAll('button, a[href], [tabindex="0"]')];
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  window.addEventListener('hashchange', () => setMainView(location.hash === '#auswertung' ? 'analytics' : 'examples'));
  window.addEventListener('nfon:crm-demo:language', refreshLanguage);
  window.addEventListener('nfon:crm-demo:visibility', event => {
    embeddedActive = event.detail.active;
    if (embeddedActive) resumeRun(); else { cancelRun(); $('capabilities-dialog').close(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelRun(); else if (embeddedActive) resumeRun(); });
  window.addEventListener('pagehide', cancelRun);
  window.addEventListener('pageshow', () => { if (mainView === 'examples') resumeRun(); });
  reducedMotion.addEventListener('change', () => { if (mainView === 'examples') resumeRun(); });
  window.DEMO_I18N.translateStatic();
  setMainView(mainView);
})();
