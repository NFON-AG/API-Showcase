const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { clientRenderer } = require('./helpers/client-render.cjs');
const expected = {
  en: 'Skill levels', de: 'Skill-Stufen', fr: 'Niveaux de compétence', es: 'Niveles de habilidad',
  it: 'Livelli di competenza', nl: 'Vaardigheidsniveaus', pl: 'Poziomy umiejętności', pt: 'Níveis de competência',
  sv: 'Kompetensnivåer', da: 'Kompetenceniveauer', fi: 'Osaamistasot', cs: 'Úrovně dovedností',
};
const evidence = [];
if (process.env.R7_PORTAL_EVIDENCE_DIR) process.on('exit', () => {
  fs.mkdirSync(process.env.R7_PORTAL_EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.R7_PORTAL_EVIDENCE_DIR, 'inspector-observations.json'), JSON.stringify(evidence, null, 2));
});

function render(language, kind = 'skill') {
  const app = clientRenderer(language);
  const serviceNumber = kind === 'skill' ? '600' : '500';
  const collection = kind === 'skill' ? 'skills' : 'queues';
  app.evaluate(`state.overview={account:'K9001',settings:{configured:true,liveWritesEnabled:false},inventory:{extensions:[{id:'200',number:'200',name:'Abrechnung'}]}};
    state.serviceGroups={account:'K9001',queues:[],skills:[],${collection}:[{serviceNumber:'${serviceNumber}',name:'Geschäftszeiten & Partner',memberRevision:'synthetic-revision',members:[{extensionNumber:'200',name:'Abrechnung',skillLevel:2,penalty:3,enabled:false}]}]};
    state.serviceDraft=buildServiceDraft(state.serviceGroups);state.serviceMode='${collection}';state.selectedServiceKey='${kind}:${serviceNumber}';state.serviceInspectorOpen=true;
    state.serviceDraft.${collection}['${serviceNumber}'].members[0].skillLevel=7;
    state.serviceDraft.${collection}['${serviceNumber}'].members[0].penalty=8;
    state.serviceCreateDrafts.${collection}.displayName='Skill-Stufen & Edited';renderServices();`);
  const translated = app.translated('#service-inspector');
  const heading = translated.elements.find(el => el.tagName === 'STRONG' && el.parentElement?.getAttribute('class') === 'service-member-settings-header');
  const details = { language, kind, expected: kind === 'skill' ? expected[language] : app.catalog['portal.priorities'][language],
    heading: heading?.textContent, rendered: app.element('#service-inspector').innerHTML, text: translated.root.textContent };
  evidence.push(details);
  return { app, translated, details };
}

for (const language of Object.keys(expected)) {
  test(`R7-PORTAL-03: rendered dynamic skill inspector uses ${language}`, () => {
    const { details } = render(language);
    assert.equal(details.heading, details.expected, 'Actual dynamic inspector heading must match the selected language');
  });
  test(`R7 inspector control: ${language} preserves literal service/member names and edited values`, () => {
    const { app, translated } = render(language);
    assert.ok(translated.elements.some(el => el.tagName === 'H3' && el.textContent === 'Geschäftszeiten & Partner'));
    assert.ok(translated.elements.some(el => el.tagName === 'SPAN' && el.textContent === 'Abrechnung (200)'));
    assert.ok(translated.elements.some(el => el.tagName === 'INPUT' && el.getAttribute('data-field') === 'skillLevel' && el.getAttribute('value') === '7'));
    assert.equal(app.evaluate("state.serviceDraft.skills['600'].members[0].enabled"), false);
    assert.equal(app.evaluate('state.serviceCreateDrafts.skills.displayName'), 'Skill-Stufen & Edited');
    assert.ok(app.element('#service-create-slot').innerHTML.includes('Skill-Stufen &amp; Edited'));
  });
  test(`R7 inspector control: rendered queue heading already uses ${language}`, () => {
    const { details, translated } = render(language, 'queue');
    assert.equal(details.heading, details.expected);
    assert.ok(translated.elements.some(el => el.tagName === 'INPUT' && el.getAttribute('data-field') === 'penalty' && el.getAttribute('value') === '8'));
  });
}
