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

function loadI18n(source, messages = {}) {
  const window = {
    NFON_MESSAGES: messages,
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

test("exact legacy system messages beat generic parameter templates with the full catalog loaded", () => {
  const catalogContext = { window: {} };
  vm.runInNewContext(readFileSync(new URL("docs/messages.js", projectRoot), "utf8"), catalogContext);
  const i18n = loadI18n(readFileSync(new URL("docs/i18n.js", projectRoot), "utf8"), catalogContext.window.NFON_MESSAGES);
  assert.equal(i18n.translate("Leitung von Eingehender Anruf ziehen", "en"), "Drag connection from Incoming call");
  assert.equal(i18n.translate("Namenskonvention TN <Rufnummer>", "en"), "Naming convention TN <phone number>");
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

test("Portal day/night preview and operation feedback translate as complete English strings", () => {
  const source = readFileSync(new URL(i18nFiles[0], projectRoot), "utf8");
  const i18n = loadI18n(source);
  const cases = [
    ["Tag/Nacht-Zeitsteuerungs-Check", "Day/night time-control check"],
    ["10 von 10 Rufnummern sind fuer eine Zeitsteuerungs-Migration eindeutig bewertbar.", "10 of 10 numbers can be evaluated unambiguously for a time-control migration."],
    ["Plan prüfen", "Check plan"],
    ["API-Daten eindeutig", "API data is unambiguous"],
    ["Zeitsteuerungen anlegen/aktualisieren", "Create/update time controls"],
    ["0 passend, 0 neu, 10 Ziel ändern", "0 matching, 0 new, 10 targets to update"],
    ["Rufnummern umhängen", "Reassign numbers"],
    ["Rufnummern auf Zeitsteuerungen umhängen", "Reassign numbers to time controls"],
    ["10 Rufnummern verfügbar", "10 numbers available"],
    ["Zeitsteuerungen offen", "Pending time controls"],
    ["Aktuelles Tagesziel", "Current day target"],
    ["Bewertung", "Assessment"],
    ["Ziel aktualisieren · Zeitsteuerung 7300", "Update target · Time control 7300"],
    ["passend · Zeitsteuerung 7300", "matching · Time control 7300"],
    ["Sprachdialog 11", "Voice dialog 11"],
    ["Originalziel bleibt als Tagesziel hinter der Zeitsteuerung erhalten.", "The original target remains the day target behind the time control."],
    ["Frontdesk/Nia bleibt Tagesziel hinter der Zeitsteuerung. Die KI-Loesung wird nicht veraendert; nur die Rufnummer wuerde initial vor den Frontdesk auf die Zeitsteuerung zeigen.", "Frontdesk/Nia remains the day target behind the time control. The AI solution is not changed; only the number would initially point to the time control before Frontdesk."],
    ["10 Rufnummern wiederhergestellt. Vorbereitete Zeitsteuerungen bleiben für den nächsten Nachtmodus erhalten.", "10 numbers restored. Prepared time controls are retained for the next night mode."],
    ["10 Rufnummern wiederhergestellt, 10 verwaltete Zeitsteuerungen gelöscht.", "10 numbers restored, 10 managed time controls deleted."],
    ["10 angelegt, 0 aktualisiert, 0 unverändert", "10 created, 0 updated, 0 unchanged"],
    ["um 11:39:04", "at 11:39:04"],
    ["+49 89 123: Zieltyp CUSTOM ist noch nicht fuer Zeitsteuerungs-Restore bewertet.", "+49 89 123: Target type CUSTOM has not yet been evaluated for time-control restoration."],
  ];

  cases.forEach(([input, expected]) => assert.equal(i18n.translate(input, "en"), expected));
  assert.equal(i18n.translate("Tag/Nacht-Zeitsteuerungs-Check", "de"), "Tag/Nacht-Zeitsteuerungs-Check");
});
