import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const projectRoot = new URL("../", import.meta.url);
const i18nFiles = [
  "docs/i18n.js",
  "landing/public/i18n.js",
  "CTI_API/public/i18n.js",
  "Portal_API/public/i18n.js",
  "CallHistory_API/public/i18n.js",
];

function loadI18n(source) {
  const window = {
    localStorage: {
      getItem: () => "en",
      setItem: () => {},
    },
  };
  const context = {
    window,
    navigator: { language: "en-GB", languages: ["en-GB"] },
    document: { body: null, addEventListener: () => {} },
  };
  vm.runInNewContext(source, context, { filename: "i18n.js" });
  return window.NFON_I18N;
}

test("all app surfaces ship the same i18n runtime", () => {
  const sources = i18nFiles.map((file) => readFileSync(new URL(file, projectRoot), "utf8"));
  sources.slice(1).forEach((source) => assert.equal(source, sources[0]));
});

test("English setup and detail strings do not degrade into mixed language", () => {
  const source = readFileSync(new URL(i18nFiles[0], projectRoot), "utf8");
  const i18n = loadI18n(source);
  const cases = [
    ["Demo-Ansicht · Setup nur lesbar", "Demo view · Setup read-only"],
    ["CTI-Zugang per lokaler Datei oder Browser-Formular setzen.", "Set CTI access via local file or browser form."],
    ["Lokale Speicherung & Sicherung", "Local storage & backup"],
    ["Lege im Ordner", "In the"],
    ["eine Datei", "folder, create a"],
    ["an. Der Server liest sie beim Start automatisch.", "file. The server reads it automatically at startup."],
    ["Tag- und Nachtmodus umschalten", "Toggle day/night mode"],
    ["Calls mit Summary oder Transcript als Quelle für User- und Ticket-Mapping.", "Calls with a summary or transcript as the source for user and ticket mapping."],
    ["Auth-URL, Token-URL, Scope und Call-History-Endpunkte sind vorbelegt. Redirect bleibt lokal standardmäßig", "Auth URL, token URL, scope, and Call History endpoints are preconfigured. The redirect remains local by default at"],
    ["8 Kontakte verbunden", "8 contacts connected"],
    ["Demo Frontdesk bearbeiten", "Edit Demo Frontdesk"],
    ["Menü ausblenden", "Hide menu"],
    ["Schritt zwischen Eingehender Anruf und Demo Frontdesk einfügen", "Insert step between Incoming call and Demo Frontdesk"],
    ["Auflegen - (Anruf beenden)", "Hang up - (End call)"],
    ["3 Nummern verfügbar", "3 numbers available"],
    ["12 Min. × 2,40 €", "12 min × 2,40 €"],
    ["Kundensätze: 12. Kundensatz anlegen", "Customer records: 12. Create customer record"],
    ["Di · 98 Calls", "Tue · 98 Calls"],
    ["Technisch: active-demo-cti-1 · answer", "Technical: active-demo-cti-1 · answer"],
    ["Portvertrag", "Port setup"],
    ["Transcript-Liste", "Transcript list"],
  ];

  cases.forEach(([input, expected]) => assert.equal(i18n.translate(input, "en"), expected));
});

test("landing scope labels are localized", () => {
  const source = readFileSync(new URL(i18nFiles[0], projectRoot), "utf8");
  const i18n = loadI18n(source);
  assert.equal(i18n.translate("API-Ebene", "en"), "API scope");
  assert.equal(i18n.translate("K-Ebene", "de"), "K-Ebene");
  assert.equal(i18n.translate("User-Ebene", "fr"), "Niveau utilisateur");
  assert.equal(i18n.translate("Browser-Konfiguration", "fr"), "Configuration du navigateur");
});
