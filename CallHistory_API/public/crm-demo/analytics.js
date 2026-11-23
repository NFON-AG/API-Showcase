'use strict';

(() => {
  const t = (...args) => window.DEMO_I18N.t(...args);
  const statusLabels = { get answered() { return t('Angenommen'); }, get missed() { return t('Verpasst'); }, get cancelled() { return t('Abgebrochen'); } };
  const statusKeys = Object.keys(statusLabels);
  const number = { format: value => new Intl.NumberFormat(window.DEMO_I18N.locale).format(value) };
  const dayFormatter = { format: value => new Intl.DateTimeFormat(window.DEMO_I18N.locale, { weekday: 'short', timeZone: 'Europe/Berlin' }).format(value) };
  const dateFormatter = { format: value => new Intl.DateTimeFormat(window.DEMO_I18N.locale, { day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' }).format(value) };
  const keyFormatter = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Berlin' });
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  let selectedDate = null;

  function dateKey(value) {
    const parts = Object.fromEntries(keyFormatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function summarize(records) {
    const result = { total: records.length, answered: 0, missed: 0, cancelled: 0, unknown: 0, transcripts: 0 };
    records.forEach(record => {
      result[statusKeys.includes(record.status) ? record.status : 'unknown'] += 1;
      if (record.transcription?.available === true) result.transcripts += 1;
    });
    result.withoutTranscript = result.total - result.transcripts;
    return result;
  }

  function aggregate(records, dates) {
    const dateKeys = dates || [...new Set(records.map(record => dateKey(record.created)))].sort();
    return {
      ...summarize(records),
      days: dateKeys.map(date => ({ date, ...summarize(records.filter(record => dateKey(record.created) === date)) }))
    };
  }

  function dateLabel(date, includeDay = false) {
    const value = new Date(`${date}T12:00:00+02:00`);
    return `${includeDay ? dayFormatter.format(value) + ', ' : ''}${dateFormatter.format(value)}`;
  }

  function setHtml(id, markup) {
    const node = document.getElementById(id);
    if (node) node.innerHTML = markup;
    return node;
  }

  function renderMetrics(totals) {
    const metrics = [
      [t('Anrufe'), totals.total],
      [t('Angenommen'), totals.answered],
      [t('Transkripte'), totals.transcripts]
    ];
    setHtml('analytics-metrics', metrics.map(([label, value]) => `<article class="kpi-card"><span class="kpi-label">${label}</span><span class="kpi-value">${number.format(value)}</span></article>`).join(''));
  }

  function renderDaily(totals) {
    // One shared zero-based scale for all dates; stacks are mutually exclusive.
    const maximum = Math.max(30, Math.ceil(Math.max(...totals.days.map(day => day.total), 0) / 10) * 10);
    const ticks = [maximum, maximum * 2 / 3, maximum / 3, 0];
    const axis = `<div class="chart-y-axis" aria-hidden="true">${ticks.map(value => `<span>${number.format(value)}</span>`).join('')}</div>`;
    const bars = totals.days.map(day => {
      const value = new Date(`${day.date}T12:00:00+02:00`);
      const label = t('{date}: {total} Anrufe, {transcripts} mit Transkript, {without} ohne verfügbares Transkript', { date: dateLabel(day.date, true), total: day.total, transcripts: day.transcripts, without: day.withoutTranscript });
      return `<button type="button" class="chart-day" data-analytics-date="${day.date}" aria-pressed="${selectedDate === day.date}" aria-controls="analytics-details" aria-label="${escape(label)}"><span class="chart-total">${number.format(day.total)}</span><span class="bar-track" aria-hidden="true"><span class="bar-segment without-transcript" style="height:${day.withoutTranscript / maximum * 100}%"></span><span class="bar-segment with-transcript" style="height:${day.transcripts / maximum * 100}%"></span></span><span class="chart-day-label">${escape(dayFormatter.format(value).replace('.', ''))}</span><span class="chart-day-date">${escape(dateLabel(day.date))}</span></button>`;
    }).join('');
    const node = setHtml('daily-chart', `<div class="daily-chart-plot">${axis}<div class="chart-days">${bars}</div></div><div class="chart-legend"><span class="legend-item"><span class="swatch transcript" aria-hidden="true"></span>${t('Mit Transkript')}</span><span class="legend-item"><span class="swatch none" aria-hidden="true"></span>${t('Ohne verfügbares Transkript')}</span></div>`);
    if (node && !node.dataset.analyticsBound) {
      node.addEventListener('click', event => {
        const button = event.target.closest('[data-analytics-date]');
        if (!button) return;
        selectedDate = button.dataset.analyticsDate;
        node.querySelectorAll('[data-analytics-date]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.analyticsDate === selectedDate)));
        renderDetails(aggregate(window.DEMO_RECORDS, window.DEMO_DATA_INFO.dates));
      });
      node.dataset.analyticsBound = 'true';
    }
  }

  function renderStatus(totals) {
    setHtml('status-chart', statusKeys.map(status => `<div class="chart-row"><span class="row-label">${statusLabels[status]}</span><span class="row-track" aria-hidden="true"><span class="row-fill ${status}" style="width:${totals.total ? totals[status] / totals.total * 100 : 0}%"></span></span><span class="row-count">${number.format(totals[status])}</span></div>`).join(''));
  }

  function renderDetails(totals) {
    const selected = selectedDate ? totals.days.find(day => day.date === selectedDate) : totals;
    if (!selected) { selectedDate = null; return renderDetails(totals); }
    const title = selectedDate ? dateLabel(selectedDate, true) : t('Gesamte Woche');
    const node = setHtml('analytics-details', `<div class="analytics-detail-heading"><h3>${escape(title)}</h3>${selectedDate ? `<button type="button" class="text-button" data-analytics-all>${t('Auswahl aufheben')}</button>` : ''}</div><p>${t('{total} Anrufe · {transcripts} mit Transkript · {without} ohne Transkript', { total: number.format(selected.total), transcripts: number.format(selected.transcripts), without: number.format(selected.withoutTranscript) })}</p>`);
    if (node) node.hidden = !selectedDate;
    if (node && !node.dataset.analyticsBound) {
      node.addEventListener('click', event => {
        if (!event.target.closest('[data-analytics-all]')) return;
        const previousDate = selectedDate;
        selectedDate = null;
        const data = aggregate(window.DEMO_RECORDS, window.DEMO_DATA_INFO.dates);
        renderDaily(data);
        renderDetails(data);
        document.querySelector(`[data-analytics-date="${previousDate}"]`)?.focus({ preventScroll: true });
      });
      node.dataset.analyticsBound = 'true';
    }
  }

  function renderTable(totals) {
    const columns = ['total', 'answered', 'missed', 'cancelled', 'transcripts'];
    const rows = totals.days.map(day => `<tr><th scope="row">${escape(dateLabel(day.date, true))}</th>${columns.map(key => `<td>${number.format(day[key])}</td>`).join('')}</tr>`).join('');
    setHtml('analytics-table-body', rows);
  }

  function render() {
    const totals = aggregate(window.DEMO_RECORDS || [], window.DEMO_DATA_INFO?.dates);
    renderMetrics(totals);
    renderDaily(totals);
    renderStatus(totals);
    renderDetails(totals);
    renderTable(totals);
    const range = document.getElementById('analytics-range');
    if (range && totals.days.length) range.textContent = `${dateLabel(totals.days[0].date)}–${dateLabel(totals.days[totals.days.length - 1].date)} 2026`;
    return totals;
  }

  window.DEMO_ANALYTICS = Object.freeze({ aggregate, summarize, dateKey });
  window.renderDemoAnalytics = render;
})();
