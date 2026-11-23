// Storage can be unavailable in private or restricted browsers. Drafts remain usable in memory.
const portalStorage = {
  getItem(key) { try { return localStorage.getItem(key); } catch { return null; } },
  setItem(key, value) { try { localStorage.setItem(key, value); } catch {} },
  removeItem(key) { try { localStorage.removeItem(key); } catch {} },
};
let overviewRequestGeneration = 0;
let serviceRequestGeneration = 0;
let extensionBatchRequestGeneration = 0;
let phonebookRequestGeneration = 0;
const flowUndoHistory = [];
let flowTextUndo = null;
// Message keys cover complete strings; the English fallback keeps the app standalone.
function portalMessage(key, fallback, params = {}) {
  return window.NFON_I18N?.message?.(key, params) || fallback.replace(/\{(\w+)\}/g, (match, name) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match);
}

function resourceActionText(action, kind) {
  const collection = kind === "queue" ? "queues" : kind === "skill" ? "skills" : kind;
  const key = `portal.resource.${action}.${collection}`;
  return portalMessage(key, action + " " + collection);
}

function portalSystemText(value) {
  return window.NFON_I18N?.translate?.(String(value ?? ""), portalLocale()) || String(value ?? "");
}

function portalMessagesMarkup(messages, separator = " · ") {
  return messages.map(item => {
    const structured = item && typeof item === "object";
    const message = structured ? item.messageKey ? portalMessage(item.messageKey, item.message || "", item.messageParams || {}) : portalSystemText(item.message) : portalSystemText(item);
    return `<span>${structured && item.label ? `<span data-i18n-ignore>${escapeHtml(item.label)}</span>: ` : ""}${escapeHtml(message)}</span>`;
  }).join(escapeHtml(separator));
}

function portalLocale() {
  return window.NFON_I18N?.getLanguage?.() || "en";
}

const STATIC_DEMO_MODE = Boolean(window.NFON_WEB_ONLY_DEMO);
const VIEW_IDS = new Set(["overview", "phonebook", "extensions", "services", "callflow", "changes"]);

function initialView() {
  const hashView = window.location.hash.replace(/^#/, "");
  return VIEW_IDS.has(hashView) ? hashView : "overview";
}

const state = {
  staticPaused: Boolean(window.NFON_DEMO_PAUSED),
  overview: null,
  flow: null,
  selectedExtensionId: "",
  selectedNodeId: "",
  selectedDidId: "",
  extensionFilter: "",
  actionPlan: null,
  loading: true,
  error: "",
  view: initialView(),
  extensionSection: "overview",
  extensionActionMode: "clone",
  demoMode: false,
  technicalOpen: false,
  railOpen: false,
  activeFlowMenu: "dids",
  inspectorOpen: false,
  profileTargetValue: "",
  daynightGatewayPreview: null,
  daynightOperationFeedback: null,
  daynightGatewayLoading: false,
  daynightGatewayApplyLoading: false,
  daynightGatewayRoutingLoading: false,
  daynightGatewayCleanupLoading: false,
  daynightGatewayResetLoading: false,
  daynightModeSwitchLoading: false,
  daynightSetupLoading: false,
  daynightAnnouncementLoading: false,
  daynightUseAnnouncement: false,
  daynightAnnouncementSource: "existing",
  daynightAnnouncementName: "",
  daynightAnnouncementAfterValue: "",
  daynightAnnouncementDisplayName: "",
  daynightAnnouncementDisplayNameEdited: false,
  daynightActive: portalStorage.getItem("nfon-portal-daynight-active") === "1",
  daynightModeModal: null,
  flowZoom: 1,
  flowFeedback: null,
  selectedBranchField: "",
  selectedNodeIds: [],
  serviceGroups: null,
  serviceDraft: null,
  serviceMode: "queues",
  selectedServiceKey: "",
  serviceFilter: "",
  serviceFeedback: null,
  serviceDraftHistory: [],
  serviceLoading: false,
  serviceCreateDrafts: {
    queues: { displayName: "", serviceNumber: "", extensionNumber: "" },
    skills: { displayName: "", serviceNumber: "", extensionNumber: "" },
  },
  serviceCreating: "",
  flowExtensionFilter: "",
  serviceInspectorOpen: false,
  selectedServiceExtensionIds: [],
  serviceSelection: null,
  paletteDrag: null,
  cableDrag: null,
  expandedServiceNodeIds: [],
  resourceModalKind: "",
  resourceDeleting: "",
  resourceCreateKind: "",
  resourceCreating: false,
  phonebookSyncLoading: false,
  phonebookUploadFeedback: null,
  phonebookFormatHelpOpen: false,
  phonebookManualDraft: { firstName: "", name: "", phone: "" },
  phonebookManualRows: [],
  phonebookManualDirty: false,
  extensionBatchRows: [
    { extensionNumber: "", displayName: "", mailboxPin: "", voicemailEmail: "", costCenter: "", language: "de", accessCentralPhoneBook: true, phoneBookHide: false },
  ],
  extensionBatchSelectedFields: ["voicemailEmail", "costCenter", "accessCentralPhoneBook", "phoneBookHide"],
  extensionBatchPlan: null,
  extensionBatchLoading: false,
  extensionBatchOptionalOpen: false,
  liveWritesSaving: false,
  customerSwitching: false,
  authLoginMode: "env",
  browserLoginDraft: {
    baseUrl: "https://portal-api.nfon.net:8090",
    apiKeyId: "",
    apiKeySecret: "",
    customerAccount: "",
  },
  browserLoginSaving: false,
  browserLoginFeedback: null,
  csrfToken: "",
};

const $ = (selector) => document.querySelector(selector);
const uiDialog = {
  open: false,
  type: "info",
  title: "",
  message: "",
  confirmLabel: "OK",
  cancelLabel: portalMessage("portal.cancel", "Cancel"),
  showCancel: false,
  pending: false,
  resolve: null,
};
let uiDialogReturnFocus = null;
let daynightDialogReturnFocus = null;
let dragState = null;
let panState = null;
let selectionRectState = null;
let paletteDragState = null;
let cableDragState = null;
let suppressCanvasClick = false;
let gestureZoomStart = 1;
let flowScrollTimer = 0;
let hoverFrame = 0;
let pendingHoverPoint = null;
let flowRenderFrame = 0;
let activeDockHoverElement = null;
let activeDockHoverNodeId = "";
let activeDockHoverNode = null;
let activeDockHoverX = "";
let activeDockHoverY = "";
const STATIC_STORAGE_VERSION = STATIC_DEMO_MODE ? "v2" : "v1";
const FLOW_LAYOUT_STORAGE_KEY = `nfon-portal-flow-layouts-${STATIC_STORAGE_VERSION}`;
const FLOW_PROFILE_STORAGE_KEY = `nfon-portal-callflow-profiles-${STATIC_STORAGE_VERSION}`;
const FLOW_DRAFT_STORAGE_KEY = `nfon-portal-flow-drafts-${STATIC_STORAGE_VERSION}`;
const FLOW_APPLIED_STORAGE_KEY = `nfon-portal-flow-applied-${STATIC_STORAGE_VERSION}`;
const DAYNIGHT_ACTIVE_STORAGE_KEY = "nfon-portal-daynight-active";
const SERVICE_DRAFT_STORAGE_KEY = `nfon-portal-service-drafts-${STATIC_STORAGE_VERSION}`;
const SERVICE_COLOR_PALETTE = [
  { id: "blue", get label() { return portalMessage("portal.blue", "Blue"); }, accent: "#1674d1", soft: "#e9f4ff" },
  { id: "green", get label() { return portalMessage("portal.green", "Green"); }, accent: "#00d981", soft: "#e7f8ef" },
  { id: "amber", get label() { return portalMessage("portal.gold", "Gold"); }, accent: "#d39a25", soft: "#fff6df" },
  { id: "teal", get label() { return portalMessage("portal.turquoise", "Turquoise"); }, accent: "#009f8f", soft: "#e4f8f5" },
  { id: "coral", get label() { return portalMessage("portal.coral", "Coral"); }, accent: "#f36b5b", soft: "#fff0ee" },
  { id: "purple", get label() { return portalMessage("portal.purple", "Purple"); }, accent: "#7146f2", soft: "#eee9ff" },
];
const FLOW_WORLD_WIDTH = 1320;
const FLOW_WORLD_HEIGHT = 1600;
const FLOW_POSITION_HEIGHT = 820;
const FLOW_NODE_WIDTH = 230;
const FLOW_NODE_HEIGHT = 98;
const FLOW_CANVAS_EDGE_PADDING = 18;
const FLOW_SAFE_TOP = 28;
const FLOW_MIN_ZOOM = 0.25;
const FLOW_MAX_ZOOM = 3;
const OPTIONAL_ENDPOINT_KEYS = new Set(["version", "basicData", "contract", "featureStatus"]);
const RESOURCE_DEFS = {
  queues: { get label() { return portalMessage("portal.queues", "Queues"); }, get itemLabel() { return portalMessage("portal.queue", "Queue"); }, type: "QUEUE", collection: "queues" },
  skills: { get label() { return portalMessage("portal.skillGroups", "Skill groups"); }, get itemLabel() { return portalMessage("portal.skillGroup", "Skill group"); }, type: "SKILL", collection: "skills" },
  ivrs: { get label() { return portalMessage("portal.voiceDialogs", "Voice dialogs"); }, get itemLabel() { return portalMessage("portal.voiceDialog", "Voice dialog"); }, type: "IVR", collection: "ivrs" },
  timeControls: { get label() { return portalMessage("portal.timeControls", "Time controls"); }, get itemLabel() { return portalMessage("portal.timeControl", "Time control"); }, type: "TIMECONTROL", collection: "timeControls" },
};
const RESOURCE_STEP_KINDS = new Set(["QUEUE", "GROUP", "SKILL", "IVR", "TIMECONTROL"]);
const WEEKDAY_OPTIONS = [
  ["MONDAY", portalMessage("portal.server.monday", "Monday")],
  ["TUESDAY", portalMessage("portal.server.tuesday", "Tuesday")],
  ["WEDNESDAY", portalMessage("portal.server.wednesday", "Wednesday")],
  ["THURSDAY", portalMessage("portal.server.thursday", "Thursday")],
  ["FRIDAY", portalMessage("portal.server.friday", "Friday")],
  ["SATURDAY", portalMessage("portal.server.saturday", "Saturday")],
  ["SUNDAY", portalMessage("portal.server.sunday", "Sunday")],
];
const EXTENSION_BATCH_OPTIONAL_FIELDS = [
  { key: "accessCentralPhoneBook", get label() { return portalMessage("portal.centralPhonebook", "Central phonebook"); }, get group() { return portalMessage("portal.extension", "Extension"); }, type: "boolean", defaultValue: true, aliases: ["zentralesTelefonbuch", "centralPhonebook"] },
  { key: "phoneBookHide", get label() { return portalMessage("portal.hideInPhonebook", "Hide in phonebook"); }, get group() { return portalMessage("portal.extension", "Extension"); }, type: "boolean", defaultValue: false, aliases: ["telefonbuchAusblenden"] },
  { key: "language", get label() { return portalMessage("portal.language", "Language"); }, get group() { return portalMessage("portal.extension", "Extension"); }, type: "text", defaultValue: "de", placeholder: "de", aliases: ["sprache"] },
  { key: "costCenter", get label() { return portalMessage("portal.costCentre", "Cost centre"); }, get group() { return portalMessage("portal.extension", "Extension"); }, type: "text", defaultValue: "", get placeholder() { return portalMessage("portal.costCentre", "Cost centre"); }, aliases: ["kostenstelle"] },
  { key: "callWaitingIndication", get label() { return portalMessage("portal.callWaiting", "Call waiting"); }, get group() { return portalMessage("portal.telephony", "Telephony"); }, type: "boolean", defaultValue: true },
  { key: "intercomEnabled", get label() { return portalMessage("portal.intercomField", "Intercom"); }, get group() { return portalMessage("portal.telephony", "Telephony"); }, type: "boolean", defaultValue: false },
  { key: "clirEnabled", get label() { return portalMessage("portal.callerId", "Caller ID"); }, get group() { return portalMessage("portal.telephony", "Telephony"); }, type: "text", defaultValue: "SHOW_BASE_NUMBER", placeholder: "SHOW_BASE_NUMBER" },
  { key: "recordingMode", get label() { return portalMessage("portal.recordingMode", "Recording mode"); }, get group() { return portalMessage("portal.telephony", "Telephony"); }, type: "text", defaultValue: "NEVER", placeholder: "NEVER" },
  { key: "ctiInfo", get label() { return portalMessage("portal.ctiInfoField", "CTI information"); }, get group() { return portalMessage("portal.telephony", "Telephony"); }, type: "text", defaultValue: "NONE", placeholder: "NONE" },
  { key: "clickToDialState", get label() { return portalMessage("portal.clickToDialField", "Click to dial"); }, get group() { return portalMessage("portal.telephony", "Telephony"); }, type: "text", defaultValue: "DEFAULT", placeholder: "DEFAULT" },
  { key: "autodialTimeout", get label() { return portalMessage("portal.autodialTimeoutField", "Autodial timeout"); }, get group() { return portalMessage("portal.telephony", "Telephony"); }, type: "number", defaultValue: 0, placeholder: "0" },
  { key: "numberguessingLength", get label() { return portalMessage("portal.numberLength", "Number length"); }, get group() { return portalMessage("portal.telephony", "Telephony"); }, type: "number", defaultValue: 0, placeholder: "0" },
  { key: "ncontrolEnabled", label: "Ncontrol", get group() { return portalMessage("portal.services", "Services"); }, type: "boolean", defaultValue: false },
  { key: "ccbs", get label() { return portalMessage("portal.callbackWhenBusy", "Callback when busy"); }, get group() { return portalMessage("portal.services", "Services"); }, type: "boolean", defaultValue: true },
  { key: "replicateAgent", get label() { return portalMessage("portal.replicateAgent", "Replicate agent"); }, get group() { return portalMessage("portal.services", "Services"); }, type: "boolean", defaultValue: false },
  { key: "timeoutAfterSipTransfer", get label() { return portalMessage("portal.timeoutAfterSipTransfer", "Timeout after SIP transfer"); }, get group() { return portalMessage("portal.services", "Services"); }, type: "number", defaultValue: 0, placeholder: "0" },
  { key: "abandonOtherSoftphones", get label() { return portalMessage("portal.signOutOtherSoftphones", "Sign out other softphones"); }, get group() { return portalMessage("portal.services", "Services"); }, type: "boolean", defaultValue: false },
  { key: "mediaGatewayEmergencyDialplanPriority", get label() { return portalMessage("portal.emergencyDialPlan", "Emergency dial plan"); }, get group() { return portalMessage("portal.services", "Services"); }, type: "text", defaultValue: "OFF", placeholder: "OFF" },
  { key: "dialPrefix", get label() { return portalMessage("portal.dialPrefix", "Dial prefix"); }, get group() { return portalMessage("portal.services", "Services"); }, type: "text", defaultValue: "", get placeholder() { return portalMessage("portal.prefix", "Prefix"); } },
  { key: "nMeeting", label: "Nmeeting", get group() { return portalMessage("portal.services", "Services"); }, type: "boolean", defaultValue: false },
  { key: "useTps", get label() { return portalMessage("portal.useTps", "Use TPS"); }, get group() { return portalMessage("portal.services", "Services"); }, type: "boolean", defaultValue: false },
  { key: "nhospitalityRoom", get label() { return portalMessage("portal.hospitalityRoomField", "Hotel room"); }, get group() { return portalMessage("portal.services", "Services"); }, type: "boolean", defaultValue: false },
  { key: "authorizeExternalByPin", get label() { return portalMessage("portal.authoriseExternalCallsByPin", "Authorise external calls by PIN"); }, get group() { return portalMessage("portal.roles", "Roles"); }, type: "boolean", defaultValue: false },
  { key: "isCoach", get label() { return portalMessage("portal.coachField", "Coach"); }, get group() { return portalMessage("portal.roles", "Roles"); }, type: "boolean", defaultValue: false },
  { key: "isCoachee", get label() { return portalMessage("portal.coacheeField", "Coachee"); }, get group() { return portalMessage("portal.roles", "Roles"); }, type: "boolean", defaultValue: false },
  { key: "deskphoneCallTranscriptionNotificationEnabled", get label() { return portalMessage("portal.deskphoneTranscriptNotification", "Deskphone transcript notification"); }, get group() { return portalMessage("portal.roles", "Roles"); }, type: "boolean", defaultValue: true },
  { key: "voicemailEmail", get label() { return portalMessage("portal.voicemailEmail", "Voicemail email"); }, groupKey: "voicemail", get group() { return portalMessage("portal.voicemail", "Voicemail"); }, type: "email", defaultValue: "", placeholder: "mail@example.de", aliases: ["email", "voicemail", "voicemail-email"] },
  { key: "announceCID", get label() { return portalMessage("portal.announceCallerNumber", "Announce caller number"); }, groupKey: "voicemail", get group() { return portalMessage("portal.voicemail", "Voicemail"); }, type: "boolean", defaultValue: true },
  { key: "announceDateTime", get label() { return portalMessage("portal.announceDateAndTime", "Announce date and time"); }, groupKey: "voicemail", get group() { return portalMessage("portal.voicemail", "Voicemail"); }, type: "boolean", defaultValue: true },
  { key: "sendEmail", get label() { return portalMessage("portal.sendVoicemailByEmail", "Send voicemail by email"); }, groupKey: "voicemail", get group() { return portalMessage("portal.voicemail", "Voicemail"); }, type: "boolean", defaultValue: false },
  { key: "deleteAfterSending", get label() { return portalMessage("portal.deleteVoicemailAfterSending", "Delete voicemail after sending"); }, groupKey: "voicemail", get group() { return portalMessage("portal.voicemail", "Voicemail"); }, type: "boolean", defaultValue: false },
];
const EXTENSION_BATCH_FIELD_MAP = new Map(EXTENSION_BATCH_OPTIONAL_FIELDS.map((field) => [field.key, field]));
const EXTENSION_FIELD_LABELS = new Map([
  ["extensionNumber", portalMessage("portal.number", "Number")],
  ["displayName", portalMessage("portal.nameField", "Name")],
  ["targetType", portalMessage("portal.type", "Type")],
  ["href", portalMessage("portal.apiLinkField", "API link")],
  ["voicemailHref", portalMessage("portal.voicemailApiLinkField", "Voicemail API link")],
  ["voicemailNumber", portalMessage("portal.mailboxNumber", "Mailbox number")],
  ["device", portalMessage("portal.device", "Device")],
  ...EXTENSION_BATCH_OPTIONAL_FIELDS.map((field) => [field.key, field.label]),
]);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Track only app-created defaults. Editing a field permanently makes it user data.
function portalDefaultAttributes(key, fallback, params = {}) {
  const value = portalMessage(key, fallback, params);
  return `data-portal-default-key="${escapeHtml(key)}" data-portal-default-fallback="${escapeHtml(fallback)}" data-portal-default-params="${escapeHtml(JSON.stringify(params))}" data-portal-default-value="${escapeHtml(value)}" value="${escapeHtml(value)}"`;
}

function portalPlaceholderAttributes(key, fallback, params = {}) {
  return `placeholder="${escapeHtml(portalMessage(key, fallback, params))}" data-i18n-placeholder="${escapeHtml(key)}" data-i18n-placeholder-params="${escapeHtml(JSON.stringify(params))}"`;
}

function resourceNamePlaceholderAttributes(kind) {
  const labels = {
    queues: ["portal.queueNameField", "Queue name"],
    skills: ["portal.skillGroupNameField", "Skill group name"],
    ivrs: ["portal.voiceDialogNameField", "Voice menu name"],
    timeControls: ["portal.timeControlNameField", "Time control name"],
  };
  return portalPlaceholderAttributes(...(labels[kind] || ["portal.nameField", "Name"]));
}

function daynightAnnouncementDisplayName(announcement = selectedAnnouncementName()) {
  if (state.daynightAnnouncementDisplayNameEdited || state.daynightAnnouncementDisplayName) return state.daynightAnnouncementDisplayName;
  return portalMessage("portal.nightAnnouncementValue", "Night announcement {p0}", { p0: announcement || portalMessage("portal.announcement", "Announcement") });
}

// Creation metadata distinguishes system defaults from user-authored flow data.
function flowNodeDefaultMetadata(kind) {
  const title = {
    TIMECONTROL: ["portal.businessHours", "Business hours"],
    IVR: ["portal.voiceDialog", "Voice dialog"],
    ANNOUNCEMENT: ["portal.announcement", "Announcement"],
    HANGUP: ["portal.hangUp", "Hang up"],
    QUEUE: ["portal.queue", "Queue"],
    GROUP: ["portal.skillGroup", "Skill group"],
    SKILL: ["portal.skillGroup", "Skill group"],
    VOICEMAIL: ["portal.voicemail", "Voicemail"],
    PHONEEXTENSION: ["portal.extension", "Extension"],
    PLACEHOLDER: ["portal.newStep", "New step"],
  }[kind];
  const subtitle = {
    PLACEHOLDER: ["portal.selectType", "Select type"],
    TIMECONTROL: ["portal.server.setTimeWindow", "Set time window"],
    IVR: ["portal.configureKeys", "Configure keys"],
    ANNOUNCEMENT: ["portal.selectAnnouncement", "Select announcement"],
    HANGUP: ["portal.endCall", "End call"],
  }[kind];
  const defaults = {};
  for (const [field, entry] of [["title", title], ["subtitle", subtitle], ["config.hours", kind === "TIMECONTROL" ? ["portal.monFri08001700", "Mon-Fri 08:00-17:00"] : null]]) {
    if (entry) defaults[field] = { key: entry[0], fallback: entry[1], value: portalMessage(...entry) };
  }
  return defaults;
}

function setFlowNodeDefault(node, field, descriptor) {
  if (!descriptor) return;
  node._i18nDefaults ||= {};
  const metadata = { ...descriptor, value: portalMessage(descriptor.key, descriptor.fallback) };
  node._i18nDefaults[field] = metadata;
  if (field === "config.hours") { node.config ||= {}; node.config.hours = metadata.value; }
  else node[field] = metadata.value;
}

function clearFlowNodeDefault(node, field) {
  if (node._i18nDefaults) delete node._i18nDefaults[field];
}

function refreshFlowNodeDefaults(node, updateInputs = false) {
  if ((node.routeNumber || node.targetNumber) && normalizeTargetType(node.type) !== "HANGUP") return;
  for (const [field, metadata] of Object.entries(node._i18nDefaults || {})) {
    const value = field === "config.hours" ? node.config?.hours : node[field];
    const input = updateInputs && node.id === state.selectedNodeId
      ? $(field === "config.hours" ? '[data-node-config-field="hours"]' : `[data-node-field="${field}"]`)
      : null;
    if ((field === "title" && node.titleUserEdited) || value !== metadata.value || (input && input.value !== metadata.value)) {
      clearFlowNodeDefault(node, field);
      continue;
    }
    setFlowNodeDefault(node, field, metadata);
    if (input) input.value = node._i18nDefaults[field].value;
  }
}

function refreshPortalFlowDefaults() {
  for (const node of state.flow?.nodes || []) {
    if (node.id === "inbound" && node.locked) node.title = portalMessage("portal.incomingCall", "Incoming call");
    refreshFlowNodeDefaults(node, true);
    syncBranchSourceConfig(node);
  }
}

function refreshPortalDefaults() {
  refreshPortalFlowDefaults();
  renderFlowFeedback();
  refreshFlowDraftPreview();
  refreshPortalAccountLabel();
  renderStatus();
  renderSettingsSummary();
  document.querySelectorAll("[data-edit-service]").forEach(button => {
    button.textContent = portalMessage("portal.edit", "Edit");
    button.setAttribute("aria-description", portalMessage("portal.edit", "Edit"));
  });
  $("#phonebook-format-help-toggle")?.setAttribute("aria-label", portalMessage("portal.showFormatHelp", "Show format help"));
  document.querySelectorAll("[data-node-edit]").forEach(button => {
    const node = state.flow?.nodes?.find(node => node.id === button.dataset.nodeEdit);
    if (!node) return;
    button.title = portalMessage("portal.edit", "Edit");
    button.setAttribute("aria-label", portalMessage("portal.editValue", "Edit {p1}", { p1: node.title }));
  });
  document.querySelectorAll("[data-node-id]").forEach(element => {
    const node = state.flow?.nodes?.find(item => item.id === element.dataset.nodeId);
    if (!node) return;
    const title = element.querySelector(".node-title");
    if (title) title.textContent = node.title;
    const subtitle = element.querySelector(".node-subtitle");
    if (subtitle) subtitle.textContent = flowNodeSubtitle(node);
    const numberMeta = element.querySelector(".node-number-meta");
    if (numberMeta) numberMeta.textContent = flowNodeNumberMeta(node);
    const detail = element.querySelector(".node-detail");
    if (detail && !["QUEUE", "GROUP", "SKILL"].includes(normalizeTargetType(node.type))) detail.textContent = flowNodeDetail(node);
    const dock = element.querySelector("[data-node-dock]");
    if (dock) {
      dock.title = portalMessage("portal.dragConnection", "Drag connection");
      dock.setAttribute("aria-label", portalMessage("portal.dragConnectionFromValue", "Drag connection from {p1}", { p1: node.title }));
    }
    const actions = element.querySelector(".node-action-buttons");
    actions?.setAttribute("aria-label", portalMessage("portal.valueActions", "{p0} actions", { p0: node.title }));
    const remove = element.querySelector("[data-node-delete]");
    if (remove) {
      remove.title = portalMessage("portal.delete", "Delete");
      remove.setAttribute("aria-label", portalMessage("portal.deleteValue", "Delete {p0}", { p0: node.title }));
    }
  });
  document.querySelectorAll("[data-insert-from][data-insert-to]").forEach(button => {
    const from = state.flow?.nodes?.find(node => node.id === button.dataset.insertFrom) || visibleFlowNodeById(button.dataset.insertFrom);
    const to = state.flow?.nodes?.find(node => node.id === button.dataset.insertTo) || visibleFlowNodeById(button.dataset.insertTo);
    if (!from || !to) return;
    const params = { p7: from.title, p8: to.title };
    button.title = portalMessage("portal.insertStepHere", "Insert step here");
    button.setAttribute("data-i18n-params", JSON.stringify(params));
    button.setAttribute("aria-label", portalMessage("portal.insertStepBetweenValueAndValue", "Insert step between {p7} and {p8}", params));
  });
  // Update only the displayed label; selected values and form state remain untouched.
  document.querySelectorAll("option[data-portal-connection-option]").forEach((option) => {
    const node = (state.flow?.nodes || []).find(item => item.id === option.value);
    if (node) option.textContent = connectionTargetLabel(node);
  });
  document.querySelectorAll("option[data-portal-target-option]").forEach((option) => {
    try {
      const target = JSON.parse(option.value);
      option.textContent = targetOptionLabel(target.targetNumber || target.number || "", target.type, target.title);
    } catch { /* Non-JSON options retain their authored label. */ }
  });
  document.querySelectorAll("[data-portal-default-key]").forEach((input) => {
    if (input.value !== input.dataset.portalDefaultValue) {
      input.removeAttribute("data-portal-default-key");
      return;
    }
    let params = {};
    try { params = JSON.parse(input.dataset.portalDefaultParams || "{}"); } catch { return; }
    if (input.id === "daynight-announcement-display-name") params.p0 = selectedAnnouncementName() || portalMessage("portal.announcement", "Announcement");
    input.value = portalMessage(input.dataset.portalDefaultKey, input.dataset.portalDefaultFallback, params);
    input.dataset.portalDefaultValue = input.value;
  });
  const preview = $("#daynight-gateway-preview");
  const searches = Array.from(preview?.querySelectorAll('input[type="search"]') || [], input => input.value);
  localizeResponseMessages(state.daynightGatewayPreview);
  renderDaynightGatewayPreview();
  renderFlowProfileActions();
  preview?.querySelectorAll('input[type="search"]').forEach((input, index) => { input.value = searches[index] || ""; if (input.value) filterSearchableSelect(input, { preserveSelection: true }); });
  if (state.daynightModeModal && typeof state.daynightModeModal === "object" && state.daynightModeModal.restoredRoutings != null) {
    state.daynightModeModal.message = portalMessage("portal.valueNumbersRestored", "Numbers restored: {p0}", { p0: state.daynightModeModal.restoredRoutings });
    renderDaynightModeModal();
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  try {
    document.body.appendChild(link);
    link.click();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    link.remove();
  }
  // Embedded browsers may consume the file after the click handler returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function safeFileTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function renderUiDialog() {
  const modal = $("#app-dialog-modal");
  if (!modal) return;
  const wasOpen = modal.getAttribute("aria-hidden") === "false";
  if (uiDialog.open && !wasOpen) uiDialogReturnFocus = document.activeElement;
  modal.className = `app-dialog-modal ${uiDialog.open ? "is-open" : ""} is-${uiDialog.pending ? "pending" : uiDialog.type || "info"}`;
  modal.setAttribute("aria-hidden", uiDialog.open ? "false" : "true");
  $("#app-dialog-title").textContent = uiDialog.title || "";
  $("#app-dialog-message").textContent = uiDialog.message || "";
  const confirmButton = $("#app-dialog-confirm");
  const cancelButton = $("#app-dialog-cancel");
  if (confirmButton) {
    confirmButton.textContent = uiDialog.confirmLabel || "OK";
    confirmButton.disabled = uiDialog.pending;
    confirmButton.hidden = uiDialog.pending;
  }
  if (cancelButton) {
    cancelButton.textContent = uiDialog.cancelLabel || portalMessage("portal.cancel", "Cancel");
    cancelButton.disabled = uiDialog.pending;
    cancelButton.hidden = uiDialog.pending || !uiDialog.showCancel;
  }
  const dialog = modal.querySelector('[role="dialog"]');
  if (dialog) dialog.tabIndex = -1;
  if (uiDialog.open) {
    const active = document.activeElement;
    if (!modal.contains(active) || active === dialog || active?.hidden || active?.disabled) {
      const button = uiDialog.showCancel && !uiDialog.pending ? cancelButton : confirmButton;
      (button && !button.hidden && !button.disabled ? button : dialog)?.focus();
    }
  } else if (wasOpen) {
    const previous = uiDialogReturnFocus;
    uiDialogReturnFocus = null;
    const target = previous?.isConnected === false ? document.getElementById(previous.id) : previous;
    target?.focus?.();
  }
}

function trapModalTab(event, modal, focusTarget = modal?.querySelector('[role="dialog"]')) {
  if (!modal) return;
  const buttons = [...modal.querySelectorAll("button, input, select, textarea, a[href], [tabindex]")].filter(button => !button.hidden && !button.disabled && button.tabIndex !== -1 && !button.classList.contains("daynight-mode-backdrop") && !button.className?.includes("backdrop") && !button.closest?.("[hidden]"));
  const index = buttons.indexOf(document.activeElement);
  event.preventDefault();
  if (!buttons.length) {
    focusTarget?.focus();
    return;
  }
  const nextIndex = index < 0 ? (event.shiftKey ? buttons.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
  buttons[nextIndex].focus();
}

function closeUiDialog(value = false) {
  const resolve = uiDialog.resolve;
  uiDialog.open = false;
  uiDialog.pending = false;
  uiDialog.resolve = null;
  renderUiDialog();
  if (resolve) resolve(value);
}

let uiNoticeTimer;

function showUiDialog(options = {}) {
  $("#action-notice")?.setAttribute("hidden", "");
  if (uiDialog.resolve) closeUiDialog(false);
  Object.assign(uiDialog, {
    open: true,
    type: options.type || "info",
    title: options.title || "",
    message: options.message || "",
    confirmLabel: options.confirmLabel || "OK",
    cancelLabel: options.cancelLabel || portalMessage("portal.cancel", "Cancel"),
    showCancel: Boolean(options.showCancel),
    pending: Boolean(options.pending),
    resolve: null,
  });
  renderUiDialog();
  if (options.pending) return Promise.resolve(true);
  return new Promise((resolve) => {
    uiDialog.resolve = resolve;
  });
}

function confirmUi({ title, message, confirmLabel = "OK", cancelLabel = portalMessage("portal.cancel", "Cancel"), type = "confirm" }) {
  return showUiDialog({ title, message, confirmLabel, cancelLabel, type, showCancel: true });
}

function showUiNotice({ title, message, type = "error", confirmLabel = "OK" }) {
  return showUiDialog({ title, message, type, confirmLabel, showCancel: false });
}

function showUiProgress({ title, message }) {
  $("#action-notice")?.setAttribute("hidden", "");
  uiDialog.open = true;
  uiDialog.type = "pending";
  uiDialog.title = title || portalMessage("portal.server.pleaseWait", "Please wait");
  uiDialog.message = message || portalMessage("portal.theActionIsRunning", "The action is running.");
  uiDialog.confirmLabel = "OK";
  uiDialog.cancelLabel = portalMessage("portal.cancel", "Cancel");
  uiDialog.showCancel = false;
  uiDialog.pending = true;
  uiDialog.resolve = null;
  renderUiDialog();
  return {
    close() {
      uiDialog.open = false;
      uiDialog.pending = false;
      renderUiDialog();
    },
    success({ title: successTitle = portalMessage("portal.server.done", "Done"), message: successMessage = portalMessage("portal.theActionHasCompleted", "The action has completed.") } = {}) {
      uiDialog.open = false;
      uiDialog.pending = false;
      uiDialog.type = "success";
      uiDialog.title = successTitle;
      uiDialog.message = successMessage;
      uiDialog.confirmLabel = "OK";
      uiDialog.showCancel = false;
      renderUiDialog();
      const notice = $("#action-notice");
      if (notice) {
        notice.innerHTML = `<strong>${escapeHtml(successTitle)}</strong><span>${escapeHtml(successMessage)}</span>`;
        notice.hidden = false;
        clearTimeout(uiNoticeTimer);
        uiNoticeTimer = setTimeout(() => { notice.hidden = true; }, 6000);
      }
    },
    error({ title: errorTitle = portalMessage("portal.server.actionFailed", "Action failed"), message: errorMessage = portalMessage("portal.checkAgain", "Check again.") } = {}) {
      uiDialog.open = true;
      uiDialog.pending = false;
      uiDialog.type = "error";
      uiDialog.title = errorTitle;
      uiDialog.message = errorMessage;
      uiDialog.confirmLabel = "OK";
      uiDialog.showCancel = false;
      renderUiDialog();
    },
  };
}

function requestCallflowRender() {
  if (flowRenderFrame) return;
  flowRenderFrame = requestAnimationFrame(() => {
    flowRenderFrame = 0;
    renderCallflow();
  });
}

function readStoredLayouts() {
  try {
    return JSON.parse(portalStorage.getItem(FLOW_LAYOUT_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function flowLayoutKey(did = selectedDid()) {
  const account = getOverview()?.account || "demo";
  const didId = did?.id || did?.name || state.selectedDidId || "default";
  return `${account}:${didId}`;
}

function applyStoredFlowLayout(flow, did) {
  normalizeCallflowStructure(flow);
  const stored = readStoredLayouts()[flowLayoutKey(did)];
  if (!stored || !Array.isArray(stored.nodes)) return sanitizeFlowPositions(flow);

  const byId = new Map(stored.nodes.map((node) => [node.id, node]));
  flow.nodes = (flow.nodes || []).map((node) => {
    const saved = byId.get(node.id);
    if (!saved) {
      clampFlowNodePosition(node);
      return node;
    }
    const position = boundedFlowPosition(saved.x, saved.y);
    return {
      ...node,
      x: position.x,
      y: position.y,
    };
  });
  return sanitizeFlowPositions(flow);
}

function saveCurrentFlowLayout() {
  if (!state.flow?.nodes?.length) return;
  normalizeCallflowStructure(state.flow);
  sanitizeFlowPositions(state.flow);
  const layouts = readStoredLayouts();
  layouts[flowLayoutKey()] = {
    updatedAt: new Date().toISOString(),
    nodes: state.flow.nodes.map((node) => ({ id: node.id, x: Number(node.x), y: Number(node.y) })),
  };
  portalStorage.setItem(FLOW_LAYOUT_STORAGE_KEY, JSON.stringify(layouts));
}

function readStoredProfiles() {
  try {
    return JSON.parse(portalStorage.getItem(FLOW_PROFILE_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveStoredProfiles(profiles) {
  portalStorage.setItem(FLOW_PROFILE_STORAGE_KEY, JSON.stringify(profiles));
}

function readStoredFlowDrafts() {
  try {
    return JSON.parse(portalStorage.getItem(FLOW_DRAFT_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveStoredFlowDrafts(drafts) {
  portalStorage.setItem(FLOW_DRAFT_STORAGE_KEY, JSON.stringify(drafts));
}

function readStoredAppliedFlows() {
  try {
    return JSON.parse(portalStorage.getItem(FLOW_APPLIED_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveStoredAppliedFlows(flows) {
  portalStorage.setItem(FLOW_APPLIED_STORAGE_KEY, JSON.stringify(flows));
}

function flowDraftKey(did = selectedDid()) {
  const account = getOverview()?.account || "demo";
  const didId = did?.id || did?.name || state.selectedDidId || "default";
  return `${account}:${didId}`;
}

function normalizeCallflowStructure(flow) {
  if (flowRoutingConflicts(flow).length) return flow;
  if (!flow?.nodes?.length) return flow;
  const inbound = flow.nodes.find((node) => node.id === "inbound");
  const trunk = flow.nodes.find((node) => node.id === "trunk" || normalizeTargetType(node.type) === "TRUNK");
  if (!inbound || !trunk) return flow;

  const trunkLabel = trunk.subtitle || trunk.title || "";
  if (trunkLabel && !inbound.detail) inbound.detail = portalMessage("portal.viaTrunkValue", "via trunk {p0}", { p0: trunkLabel });

  flow.nodes.forEach(hydrateExistingResourceNode);

  const nextEdges = [];
  const seen = new Set();
  for (const edge of flow.edges || []) {
    if (edge.from === inbound.id && edge.to === trunk.id) continue;
    if (edge.to === trunk.id) continue;
    const normalized = {
      ...edge,
      from: edge.from === trunk.id ? inbound.id : edge.from,
    };
    const key = `${normalized.from}->${normalized.to}:${normalized.branchField || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    nextEdges.push(normalized);
  }

  flow.nodes = flow.nodes.filter((node) => node !== trunk);
  flow.edges = nextEdges;
  return flow;
}

function hydrateExistingResourceNode(node) {
  if (!node || node.locked) return;
  const kind = normalizeTargetType(node.type);
  const routeNumber = node.routeNumber || "";
  const targetNumber = node.targetNumber || "";
  if (RESOURCE_STEP_KINDS.has(kind) && !node.config?.portalMode && (routeNumber || targetNumber || node.config?.branchSource === "verified-live")) {
    node.config ||= {};
    node.config.portalMode = "existing";
  }
  if (kind !== "IVR" || node.config?.portalMode !== "existing") return;
  const liveIvr = inventoryIvrForTarget(node, routeNumber, targetNumber);
  if (!liveIvr) return;
  const liveConfig = liveIvrConfig(liveIvr);
  node.title = liveIvr.name || node.title;
  node.subtitle = liveIvr.extensionNumber ? portalMessage("portal.voiceDialogValue", "Voice dialog {p0}", { p0: liveIvr.extensionNumber }) : node.subtitle;
  node.targetNumber = liveIvr.extensionNumber || node.targetNumber || "";
  node.routeNumber = liveIvr.serviceNumber || node.routeNumber || "";
  node.config = {
    ...node.config,
    ...liveConfig,
    portalMode: "existing",
  };
}

function didMatchesAppliedSnapshot(did, snapshot) {
  if (!did || !snapshot) return false;
  const expectedType = normalizeTargetType(snapshot.target?.type || snapshot.rootType || "");
  const liveType = normalizeTargetType(did.destinationType || "");
  if (expectedType && liveType && expectedType !== liveType) return false;
  if ((snapshot.did || "") !== (did.name || did.id || "")) return false;
  const target = snapshot.target || {};
  const snapshotRoute = String(target.routeNumber || target.serviceNumber || "");
  const snapshotNumber = String(target.targetNumber || target.number || "");
  const liveRoute = String(did.destinationServiceNumber || "");
  const liveNumber = String(did.destinationExtension || "");
  // A saved canvas is only an overlay for an exact live destination identity.
  // Older snapshots without target metadata cannot prove that routing is unchanged.
  const expectedRoute = snapshotRoute || snapshotNumber;
  const actualRoute = liveRoute || liveNumber;
  if (!expectedType || !liveType || !expectedRoute || !actualRoute) return false;
  if (expectedRoute !== actualRoute) return false;
  if (snapshotNumber && liveNumber && snapshotNumber !== liveNumber) return false;
  return true;
}

function flowHasVerifiedLiveBranches(flow) {
  return (flow?.nodes || []).some((node) => {
    const kind = normalizeTargetType(node.type);
    if (!["IVR", "TIMECONTROL", "ANNOUNCEMENT", "QUEUE"].includes(kind)) return false;
    if (node.config?.branchSource !== "verified-live") return false;
    if (kind === "IVR") {
      return Boolean((node.config.ivrKeys || []).length || node.config.timeoutTarget);
    }
    return true;
  });
}

function applyStoredAppliedFlow(flow, did) {
  normalizeCallflowStructure(flow);
  if (flowHasVerifiedLiveBranches(flow)) return flow;
  const stored = readStoredAppliedFlows()[flowDraftKey(did)];
  if (!stored?.flow?.nodes?.length || !didMatchesAppliedSnapshot(did, stored)) return flow;
  normalizeCallflowStructure(stored.flow);
  return {
    ...flow,
    nodes: stored.flow.nodes,
    edges: stored.flow.edges || flow.edges,
    appliedSnapshotAt: stored.appliedAt,
    appliedTarget: stored.target,
  };
}

function flowOriginalMatchesDid(original, did) {
  if (!did || !original) return true;
  const didId = did.name || did.id || "";
  const originalDid = original.did || "";
  const typeMatches = normalizeTargetType(original.destinationType || "") === normalizeTargetType(did.destinationType || "");
  const extensionMatches = String(original.destinationExtension || "") === String(did.destinationExtension || "");
  return (!originalDid || originalDid === didId) && typeMatches && extensionMatches;
}

function applyStoredFlowDraft(flow, did) {
  normalizeCallflowStructure(flow);
  const stored = readStoredFlowDrafts()[flowDraftKey(did)];
  if (!stored?.flow?.nodes?.length) return flow;
  const providerConflict = !flowOriginalMatchesDid(stored.flow.original, did)
    || Boolean(stored.flow.providerRevision && stored.flow.providerRevision !== flow.providerRevision);
  if (flow?.appliedSnapshotAt && stored.updatedAt && new Date(stored.updatedAt) <= new Date(flow.appliedSnapshotAt)) {
    return flow;
  }
  normalizeCallflowStructure(stored.flow);
  // Opening the editor starts from current routing. Keep older work available
  // without putting the provider's current flow behind a manual reset step.
  if (providerConflict) return { ...flow, previousDraft: { updatedAt: stored.updatedAt, flow: stored.flow } };
  return {
    ...flow,
    nodes: stored.flow.nodes,
    edges: stored.flow.edges || flow.edges,
    draftUpdatedAt: stored.updatedAt,
    providerRevision: stored.flow.providerRevision || flow.providerRevision,
    ...(stored.previousDraft ? { previousDraft: stored.previousDraft } : {}),
  };
}

function restorePreviousFlowDraft() {
  const previous = state.flow?.previousDraft;
  if (!previous?.flow?.nodes?.length) return;
  rememberFlowUndo();
  state.flow.nodes = clone(previous.flow.nodes);
  state.flow.edges = clone(previous.flow.edges || []);
  delete state.flow.previousDraft;
  delete state.flow.providerConflict;
  state.selectedNodeId = "";
  state.selectedNodeIds = [];
  state.inspectorOpen = false;
  state.selectedBranchField = "";
  saveCurrentFlowDraft(false);
}

function saveCurrentFlowDraft(showFeedback = true) {
  if (!state.flow?.nodes?.length) return;
  normalizeCallflowStructure(state.flow);
  const drafts = readStoredFlowDrafts();
  const updatedAt = new Date().toISOString();
  drafts[flowDraftKey()] = {
    updatedAt,
    did: selectedDid()?.name || "",
    previousDraft: state.flow.previousDraft,
    flow: {
      source: state.flow.source,
      didId: state.flow.didId,
      original: state.flow.original,
      providerRevision: state.flow.providerRevision,
      nodes: clone(state.flow.nodes),
      edges: clone(state.flow.edges || []),
    },
  };
  saveStoredFlowDrafts(drafts);
  state.flow.draftUpdatedAt = updatedAt;
  // All draft editors persist here; their previous validation describes an older draft.
  if (state.actionPlan?.context === "callflow") state.actionPlan = null;
  state.flowFeedback = null;
  renderFlowFeedback();
  renderFlowPlan();
  if (showFeedback) {
    state.flowFeedback = {
      ok: true,
      title: portalMessage("portal.draftSaved", "Draft saved"),
      message: portalMessage("portal.layoutAndStepsWereSavedLocallyValue", "Layout and steps were saved locally ({p0}).", { p0: formatTime(updatedAt) }),
    };
    renderFlowFeedback();
  }
}

function clearCurrentFlowDraft() {
  const drafts = readStoredFlowDrafts();
  delete drafts[flowDraftKey()];
  saveStoredFlowDrafts(drafts);
}

function reloadCurrentFlowWithoutDraft() {
  const did = selectedDid();
  const baseFlow = applyStoredFlowLayout(buildFlowForDid(did, getOverview()), did);
  flowUndoHistory.length = 0;
  state.flow = applyStoredAppliedFlow(baseFlow, did);
  state.selectedNodeId = "";
  state.selectedNodeIds = [];
  state.selectedBranchField = "";
  state.inspectorOpen = false;
  state.actionPlan = null;
  state.flowFeedback = {
    ok: true,
    titleKey: "portal.localDraftDeleted",
    title: portalMessage("portal.localDraftDeleted", "Local draft deleted"),
    messageKey: "portal.theLiveStateIsTheStartingPointAgain",
    message: portalMessage("portal.theLiveStateIsTheStartingPointAgain", "The live state is the starting point again."),
  };
}

function saveAppliedFlowSnapshot(flow, result, did = selectedDid()) {
  if (!flow?.nodes?.length || !did) return;
  const flows = readStoredAppliedFlows();
  const target = result?.target || {};
  const firstStep = flowStartNode(flow);
  flows[flowDraftKey(did)] = {
    appliedAt: result?.appliedAt || new Date().toISOString(),
    did: did.name || did.id || "",
    target,
    rootType: target.type || firstStep?.type || "",
    flow: {
      source: "portal-applied-snapshot",
      didId: flow.didId || did.id || did.name || "",
      original: flow.original || {},
      nodes: clone(flow.nodes),
      edges: clone(flow.edges || []),
    },
  };
  saveStoredAppliedFlows(flows);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function flowMenuSafeAreaWorld() {
  const zoom = state.flowZoom || 1;
  const fallback = {
    left: FLOW_CANVAS_EDGE_PADDING,
    right: 210 / zoom,
    top: 14 / zoom,
    bottom: 292 / zoom,
  };
  const canvas = $("#callflow-canvas");
  const launcher = $(".flow-menu-launcher");
  if (!canvas || !launcher) return fallback;
  const canvasRect = canvas.getBoundingClientRect();
  const launcherRect = launcher.getBoundingClientRect();
  if (!canvasRect.width || !launcherRect.width) return fallback;
  if (launcherRect.bottom <= canvasRect.top || launcherRect.top >= canvasRect.bottom
    || launcherRect.right <= canvasRect.left || launcherRect.left >= canvasRect.right) {
    return { left: 0, right: 0, top: 0, bottom: 0 };
  }
  const padding = 28;
  return {
    left: Math.max(0, (launcherRect.left - canvasRect.left + canvas.scrollLeft - padding) / zoom),
    right: Math.max(0, (launcherRect.right - canvasRect.left + canvas.scrollLeft + padding) / zoom),
    top: Math.max(0, (launcherRect.top - canvasRect.top + canvas.scrollTop - padding) / zoom),
    bottom: Math.max(0, (launcherRect.bottom - canvasRect.top + canvas.scrollTop + padding) / zoom),
  };
}

function boundedFlowPosition(x, y) {
  const minX = (FLOW_CANVAS_EDGE_PADDING / FLOW_WORLD_WIDTH) * 100;
  const minY = (FLOW_SAFE_TOP / FLOW_POSITION_HEIGHT) * 100;
  return { x: Math.max(Number(x) || minX, minX), y: Math.max(Number(y) || minY, minY) };
}

function safeFlowPosition(x, y) {
  let { x: safeX, y: safeY } = boundedFlowPosition(x, y);
  const nodeLeft = (safeX / 100) * FLOW_WORLD_WIDTH;
  const nodeTop = (safeY / 100) * FLOW_POSITION_HEIGHT;
  const menuSafe = flowMenuSafeAreaWorld();
  const overlapsMenu = nodeLeft < menuSafe.right
    && nodeLeft + FLOW_NODE_WIDTH > menuSafe.left
    && nodeTop < menuSafe.bottom
    && nodeTop + FLOW_NODE_HEIGHT > menuSafe.top;
  if (overlapsMenu) {
    // A wrapped toolbar spans the canvas: move below it instead of beyond its right edge.
    if (menuSafe.right - nodeLeft > menuSafe.bottom - nodeTop) {
      safeY = Math.max(safeY, ((menuSafe.bottom + FLOW_CANVAS_EDGE_PADDING) / FLOW_POSITION_HEIGHT) * 100);
    } else {
      safeX = Math.max(safeX, ((menuSafe.right + FLOW_CANVAS_EDGE_PADDING) / FLOW_WORLD_WIDTH) * 100);
    }
  }
  return {
    x: safeX,
    y: safeY,
  };
}

function vacantFlowPosition(x, y, nodes = [], candidate = {}) {
  const gap = 24;
  // New cards have no DOM yet. Reserve space for wrapped titles, detail text and controls.
  const candidateHeight = Math.max(240, 120 + Math.ceil(String(candidate.title || "").length / 22) * 20
    + Math.ceil(String(candidate.subtitle || "").length / 30) * 18);
  const occupied = nodes.filter(node => node.id !== candidate.id).map(node => {
    const box = nodeWorldBox(node);
    return { ...box, height: Math.max(box.height, 240) };
  });
  for (let ring = 0; ring <= occupied.length + 1; ring += 1) {
    for (let row = 0; row <= ring; row += 1) {
      const position = safeFlowPosition(x + (ring - row) * (FLOW_NODE_WIDTH + gap) / FLOW_WORLD_WIDTH * 100,
        y + row * (candidateHeight + gap) / FLOW_POSITION_HEIGHT * 100);
      const left = position.x / 100 * FLOW_WORLD_WIDTH;
      const top = position.y / 100 * FLOW_POSITION_HEIGHT;
      if (!occupied.some(box => left < box.x + box.width + gap && left + FLOW_NODE_WIDTH + gap > box.x
        && top < box.y + box.height + gap && top + candidateHeight + gap > box.y)) return position;
    }
  }
  return safeFlowPosition(x, (Math.max(0, ...occupied.map(box => box.y + box.height)) + gap) / FLOW_POSITION_HEIGHT * 100);
}

function clampFlowNodePosition(node) {
  if (!node) return;
  const position = boundedFlowPosition(node.x, node.y);
  node.x = position.x;
  node.y = position.y;
}

function sanitizeFlowPositions(flow) {
  if (!flow?.nodes?.length) return flow;
  flow.nodes.forEach(clampFlowNodePosition);
  return flow;
}

function formatTime(value) {
  if (!value) return portalMessage("portal.notCheckedYet", "Not checked yet");
  return new Intl.DateTimeFormat(portalLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function getOverview() {
  if (state.demoMode && state.overview?.demoFallback) return state.overview.demoFallback;
  return state.overview;
}

function isBrowserLoggedIn(overview = getOverview()) {
  return Boolean(overview?.settings?.browserCredentialsActive);
}

function isPortalLoggedIn(overview = getOverview()) {
  return Boolean(overview?.settings?.configured);
}

function visibleAccount(overview = getOverview()) {
  return isPortalLoggedIn(overview) ? overview?.account || overview?.settings?.account || "" : "";
}

function overviewShowsManagedDaynightRouting(overview = getOverview()) {
  const dids = overview?.inventory?.dids || [];
  if (typeof overview?.daynight?.active === "boolean") return overview.daynight.active;
  if (!dids.length) return false;
  return dids.some((did) => {
    const type = normalizeTargetType(did.destinationType);
    const name = String(did.destinationName || did.value || "");
    return type === "TIMECONTROL" && name.startsWith("TN ");
  });
}

function syncDaynightActiveFromOverview(overview = getOverview()) {
  const activeInPortal = overviewShowsManagedDaynightRouting(overview);
  if (state.daynightActive !== activeInPortal) {
    state.daynightActive = activeInPortal;
    portalStorage.setItem(DAYNIGHT_ACTIVE_STORAGE_KEY, activeInPortal ? "1" : "0");
  }
}

function portalLiveWritesEnabled() {
  const settings = getOverview()?.settings;
  return Boolean(settings?.liveWritesEnabled && !settings.liveWritesLocked);
}

function liveWritesEnabled() {
  return portalLiveWritesEnabled() && !state.daynightActive;
}

function localWritesEnabled() { return liveWritesEnabled() || STATIC_DEMO_MODE; }

function localApplyPermitted() {
  return localWritesEnabled() || (!state.daynightActive && daynightSetupPermitted() && Boolean(state.overview?.settings?.writeContext));
}

function liveApplyPermitted() { return !STATIC_DEMO_MODE && localApplyPermitted(); }

function portalApplyPermitted() {
  return !STATIC_DEMO_MODE && (portalLiveWritesEnabled() || (daynightSetupPermitted() && Boolean(state.overview?.settings?.writeContext)));
}

async function enableActionWrites(writeContext, current = () => isCurrentWriteContext(writeContext), { allowNightMode = false } = {}) {
  const permitted = allowNightMode ? portalApplyPermitted : localApplyPermitted;
  const enabled = allowNightMode ? portalLiveWritesEnabled : localWritesEnabled;
  if (!current()) return false;
  if (!permitted()) throw new Error(liveWritesDisabledText());
  if (enabled()) return true;
  const result = await fetchJson("/api/settings/live-writes", {
    method: "POST", writeContext, body: JSON.stringify({ enabled: true }),
  });
  if (!current()) return false;
  if (!permitted() || result.ok === false || result.settings?.writeContext !== writeContext) {
    throw new Error(result.message || liveWritesDisabledText());
  }
  state.overview.settings = result.settings;
  if (!enabled()) throw new Error(liveWritesDisabledText());
  return true;
}

function liveWritesDisabledTitle() {
  return STATIC_DEMO_MODE ? portalMessage("portal.demo.blockedTitle", "Unavailable in demo mode") : portalMessage("portal.liveWritesDisabled", "Live writes disabled");
}

if (STATIC_DEMO_MODE) window.NFON_SHOW_DEMO_BLOCKED = () => showUiNotice({ title: liveWritesDisabledTitle(), message: liveWritesDisabledText(), type: "warning" });

function liveWritesDisabledText() {
  if (STATIC_DEMO_MODE) return portalMessage("portal.demo.blockedMessage", "This action is unavailable in demo mode.");
  if (getOverview()?.settings?.liveWritesLocked) {
    return portalMessage("portal.liveWritesLockedByServer", "Read-only mode is enforced by the server.");
  }
  if (state.daynightActive) {
    return portalMessage("portal.nightModeIsActiveChangesAreLockedUntilDay", "Night mode is active. Changes are locked until day mode is restored.");
  }
  return portalMessage("portal.liveWritesAreDisabledInSetupDryRunsAnd", "Live writes are disabled in setup. Dry runs and previews stay active.");
}

function setDaynightActive(active, modalMode = "") {
  state.daynightActive = Boolean(active);
  portalStorage.setItem(DAYNIGHT_ACTIVE_STORAGE_KEY, state.daynightActive ? "1" : "0");
  if (modalMode) {
    state.daynightModeModal = modalMode;
  }
  renderDaynightModeModal();
  updateDaynightHeaderButton();
  renderView();
}

function closeDaynightModeModal() {
  state.daynightModeModal = null;
  renderDaynightModeModal();
}

function renderDaynightModeModal() {
  const modal = $("#daynight-mode-modal");
  if (!modal) return;
  const wasOpen = !modal.hidden;
  const modalState = state.daynightModeModal;
  const mode = typeof modalState === "string" ? modalState : modalState?.mode;
  if (mode && !wasOpen) daynightDialogReturnFocus = document.activeElement;
  modal.hidden = !mode;
  modal.classList.toggle("is-open", Boolean(mode));
  if (!mode) {
    if (wasOpen) {
      const previous = daynightDialogReturnFocus;
      daynightDialogReturnFocus = null;
      const target = previous?.isConnected === false ? document.getElementById(previous.id) : previous;
      target?.focus?.();
    }
    return;
  }
  const presets = {
    night: {
      symbol: "N",
      title: portalMessage("portal.nightModeActive_aaf0e", "Night mode active"),
      message: portalMessage("portal.theNumbersNowRouteThroughThePreparedTimeControls", "The numbers now route through the prepared time controls. Live changes in the app are locked."),
    },
    day: {
      symbol: "T",
      title: portalMessage("portal.dayModeActive", "Day mode active"),
      message: portalMessage("portal.theDayTargetsHaveBeenRestoredLiveChangesAre", "The day targets have been restored. Live changes are available again."),
    },
    loading: {
      symbol: "...",
      title: portalMessage("portal.server.pleaseWait", "Please wait"),
      message: portalMessage("portal.thePortalApiIsProcessingTheSwitchThisMay", "The Portal API is processing the switch. This may take a moment."),
    },
    setup: {
      symbol: "!",
      title: portalMessage("portal.setupIncomplete", "Setup incomplete"),
      message: portalMessage("portal.firstSaveTheDefaultInSetupAndPrepareThe", "First save the default in Setup and prepare the complete time-control plan."),
    },
    error: {
      symbol: "!",
      title: portalMessage("portal.switchFailed", "Switch failed"),
      message: portalMessage("portal.thePortalApiCouldNotCompleteTheSwitchCheck", "The Portal API could not complete the switch. Check Setup."),
    },
  };
  const data = { ...(presets[mode] || presets.error), ...(typeof modalState === "object" ? modalState : {}) };
  $("#daynight-mode-modal-symbol").textContent = data.symbol;
  $("#daynight-mode-modal-title").textContent = data.title;
  $("#daynight-mode-modal-message").textContent = data.message;
  const dialog = modal.querySelector(".daynight-mode-dialog");
  if (!dialog) return;
  const existingActions = dialog.querySelector(".daynight-mode-actions");
  if (existingActions) existingActions.remove();
  const defaultClose = dialog.querySelector("[data-daynight-mode-close]:not(.daynight-mode-backdrop)");
  if (defaultClose) defaultClose.hidden = Boolean(data.actions?.length || data.busy);
  if (data.actions?.length) {
    const actions = document.createElement("div");
    actions.className = "daynight-mode-actions";
    actions.innerHTML = data.actions.map((action) => `
      <button class="${action.kind === "primary" ? "primary-button" : "secondary-button"}" type="button" data-daynight-mode-action="${escapeHtml(action.action)}">
        ${escapeHtml(action.label)}
      </button>
    `).join("");
    dialog.appendChild(actions);
  }
  dialog.tabIndex = -1;
  const active = document.activeElement;
  if (!dialog.contains(active) || active === dialog || active?.hidden || active?.disabled) {
    const button = [...dialog.querySelectorAll("button")].find(item => !item.hidden && !item.disabled);
    (button || dialog).focus();
  }
}

function setDaynightOperationFeedback(result, fallbackTitle = portalMessage("portal.actionCompleted", "Action completed")) {
  const details = [];
  if (Number.isFinite(result?.restoredRoutings)) {
    details.push(portalMessage("portal.valueNumbersRestored", "{p0} numbers restored", { p0: result.restoredRoutings, p1: result.restoredRoutings === 1 ? "" : "n" }));
  }
  if (Number.isFinite(result?.deletedTimeControls)) {
    details.push(portalMessage("portal.valueTimeControlsDeleted", "{p0} time controls deleted", { p0: result.deletedTimeControls, p1: result.deletedTimeControls === 1 ? "" : "en" }));
  }
  if (Array.isArray(result?.deleted)) {
    details.push(portalMessage("portal.valueOldTimeControlsDeleted", "{p0} old time controls deleted", { p0: result.deleted.length, p1: result.deleted.length === 1 ? "" : "en" }));
  }
  if (Array.isArray(result?.results)) {
    const created = result.results.filter((item) => item.action === "create-daynight-gateway").length;
    const updated = result.results.filter((item) => item.action === "update-daynight-gateway").length;
    const skipped = result.results.filter((item) => item.skipped).length;
    const failed = result.results.filter((item) => item.ok === false).length;
    const failedItems = result.results.filter((item) => item.ok === false);
    if (created || updated || skipped) {
      details.push(portalMessage("portal.valueCreatedValueUpdatedValueUnchanged", "{p0} created, {p1} updated, {p2} unchanged", { p0: created, p1: updated, p2: skipped }));
    }
    if (failed) {
      details.push(portalMessage("portal.valueFailed", "{p0} failed", { p0: failed }));
      details.push(...failedItems.slice(0, 3).map((item) => `${item.did || item.gateway || portalMessage("portal.entry", "entry")}: ${item.error || item.message || portalMessage("portal.apiError", "API error")}`));
    }
  }
  const appliedAt = result?.appliedAt || new Date().toISOString();
  state.daynightOperationFeedback = {
    ok: result?.ok !== false,
    title: result?.title || fallbackTitle,
    message: result?.message || "",
    details,
    appliedAt,
  };
}

async function refreshDaynightAfterLiveError(error, fallbackTitle) {
  const body = error?.body || {};
  setDaynightOperationFeedback({
    ok: false,
    title: body.title || fallbackTitle,
    message: body.message || error.message || "",
    results: body.results || [],
    attempts: body.attempts || [],
    appliedAt: body.appliedAt || new Date().toISOString(),
  }, fallbackTitle);

  try {
    await loadOverview();
    await previewDaynightGateway({ preserveFeedback: true });
  } catch (refreshError) {
    state.daynightGatewayPreview = {
      ...(state.daynightGatewayPreview || {}),
      ok: false,
      title: fallbackTitle,
      message: portalMessage("portal.valueTheCurrentPbxStateCouldNotBeReloaded", "{p0} The current PBX state could not be reloaded afterwards: {p1}", { p0: error.message || "Live-Aktion fehlgeschlagen", p1: refreshError.message }),
      blockers: [error.message || fallbackTitle, refreshError.message],
    };
  }
}

function endpointList() {
  return Object.entries(getOverview()?.endpoints || {});
}

function endpointIssues() {
  return endpointList().filter(([key, endpoint]) => !OPTIONAL_ENDPOINT_KEYS.has(key) && !endpoint.optional && !endpoint.ok);
}

function portalEndpointErrorText(endpoint) {
  if (endpoint.ok) return "";
  const params = { code: endpoint.errorCode || "PORTAL_NETWORK_ERROR" };
  switch (endpoint.errorKind) {
    case "dns": return portalMessage("portal.transportDns", "Portal API hostname could not be resolved ({code}).", params);
    case "timeout": return portalMessage("portal.transportTimeout", "Portal API connection timed out ({code}).", params);
    case "tls": return portalMessage("portal.transportTls", "Portal API secure connection failed ({code}).", params);
    case "connection": return portalMessage("portal.transportConnection", "Portal API connection could not be established ({code}).", params);
    case "network": return portalMessage("portal.transportNetwork", "Portal API network request failed ({code}).", params);
    default: return portalSystemText(endpoint.error || portalMessage("portal.noDetailsAvailable", "No details available."));
  }
}

function portalConnectionStatus(overview = getOverview()) {
  if (overview?.connection?.authenticationRequired) return { mode: "auth-required", tone: "neutral", label: portalMessage("shared.authRequired", "Sign-in required"), detail: "" };
  if (state.loading) return { tone: "warning", label: portalMessage("portal.checking_d8a17", "Checking"), detail: "" };
  if (state.error) return { tone: "error", label: portalMessage("portal.error", "Error"), detail: portalSystemText(state.error) };
  if (state.demoMode || window.NFON_WEB_ONLY_DEMO || overview?.demo) {
    return { mode: "demo", tone: "warning", label: "Demo", detail: portalMessage("portal.demoDataActive", "Demo data active") };
  }

  const required = Object.entries(overview?.endpoints || {}).filter(([key, endpoint]) => !OPTIONAL_ENDPOINT_KEYS.has(key) && !endpoint.optional);
  const connection = overview?.connection;
  const total = connection?.requiredTotal ?? required.length;
  const loaded = connection?.requiredLoaded ?? required.filter(([, endpoint]) => endpoint.ok).length;
  const status = !overview?.settings?.configured ? "unconfigured"
    : connection?.state || (!total ? "unchecked" : !loaded ? "unavailable" : loaded < total ? "partial" : "connected");
  const detail = total
    ? portalMessage("portal.connectionAreasLoaded", "{loaded} of {total} required API areas loaded.", { loaded, total })
    : portalMessage("portal.connectionNotChecked", "Connection not checked yet");
  if (required.some(([, endpoint]) => endpoint.status === 401)) return {tone:"warning",label:portalMessage("portal.loginRequired", "Sign in required"),detail:""};
  if (status === "unconfigured") return { tone: "warning", label: portalMessage("portal.loginRequired", "Login required"), detail: "" };
  if (status === "unchecked") return { tone: "warning", label: portalMessage("portal.notCheckedYet", "Not checked yet"), detail: portalMessage("portal.connectionNotChecked", "Connection not checked yet") };
  if (status === "unavailable") return { tone: "error", label: portalMessage("portal.connectionFailed", "Connection failed"), detail };
  if (status === "partial") return { tone: "warning", label: portalMessage("portal.apiPartiallyLoaded", "API partially loaded"), detail };
  if (status === "connected") return { tone: "online", label: portalMessage("portal.ready", "Ready"), detail };
  return { tone: "warning", label: portalMessage("portal.notCheckedYet", "Not checked yet"), detail: portalMessage("portal.connectionNotChecked", "Connection not checked yet") };
}

function resourceNumber(item) {
  return String(item?.serviceNumber || item?.id || item?.extensionNumber || item?.value || "").trim();
}

function resourceExtension(item) {
  return String(item?.extensionNumber || item?.value || "").trim();
}

function resourceMatchesTarget(kind, item, target = {}) {
  const def = RESOURCE_DEFS[kind];
  if (!def || !item || !target) return false;
  if (normalizeTargetType(target.type || target.destinationType) !== def.type) return false;
  const route = String(target.routeNumber || target.serviceNumber || target.destinationServiceNumber || target.destinationExtension || target.number || target.targetNumber || target.extensionNumber || "").trim();
  const extension = String(target.targetNumber || target.number || target.extensionNumber || target.destinationExtension || "").trim();
  const candidates = new Set([
    resourceNumber(item),
    resourceExtension(item),
    String(item.href || "").trim(),
  ].filter(Boolean));
  return (route && candidates.has(route)) || (extension && candidates.has(extension));
}

function resourceConnections(kind, item) {
  const overview = getOverview();
  const links = [];
  for (const did of overview?.inventory?.dids || []) {
    if (resourceMatchesTarget(kind, item, did)) {
      links.push({ label: portalMessage("portal.numberValue", "Number {p0}", { p0: did.name || did.id }), detail: did.value || did.destinationName || portalMessage("portal.server.directTarget", "Direct target") });
    }
  }
  for (const ivr of overview?.inventory?.ivrs || []) {
    for (const route of ivr.keyRoutes || []) {
      if (resourceMatchesTarget(kind, item, route.target)) {
        links.push({ label: portalMessage("portal.voiceDialogValue", "Voice dialog {p0}", { p0: ivr.name }), detail: portalMessage("portal.keyValue", "Key {p0}", { p0: route.number }) });
      }
    }
    if (resourceMatchesTarget(kind, item, ivr.timeoutTarget)) {
      links.push({ label: portalMessage("portal.voiceDialogValue", "Voice dialog {p0}", { p0: ivr.name }), detail: "Timeout" });
    }
  }
  return links;
}

function resourceItems(kind) {
  const def = RESOURCE_DEFS[kind];
  return def ? getOverview()?.inventory?.[def.collection] || [] : [];
}

function selectedExtension() {
  const extensions = getOverview()?.inventory?.extensions || [];
  return extensions.find((extension) => extension.id === state.selectedExtensionId) || extensions[0] || null;
}

function selectedNode() {
  if (!state.selectedNodeId) return null;
  return (state.flow?.nodes || []).find((node) => node.id === state.selectedNodeId)
    || visibleFlowNodeById(state.selectedNodeId)
    || null;
}

function selectedNodes() {
  const selectedIds = Array.isArray(state.selectedNodeIds) ? state.selectedNodeIds : [];
  if (!selectedIds.length) return selectedNode() ? [selectedNode()] : [];
  const selected = new Set(selectedIds);
  return (state.flow?.nodes || []).filter((node) => selected.has(node.id));
}

function selectedDid() {
  const dids = getOverview()?.inventory?.dids || [];
  return dids.find((did) => did.id === state.selectedDidId) || dids[0] || null;
}

function nextExtensionNumber(extension) {
  const current = Number.parseInt(extension?.number || "200", 10);
  if (Number.isFinite(current)) return String(current + 100);
  return "299";
}

function localizeResponseMessages(value) {
  if (Array.isArray(value)) return value.map(localizeResponseMessages);
  if (!value || typeof value !== "object") return value;
  const opaque = new Set(["inventory", "items", "data", "raw", "body", "contacts", "callflow"]);
  for (const field of ["message", "error", "title", "note", "behaviorNote", "reason", "memberError"]) {
    if (value[field + "Key"]) value[field] = portalMessage(value[field + "Key"], value[field] || "", value[field + "Params"] || {});
  }
  for (const [key, item] of Object.entries(value)) if (!opaque.has(key) && !/Key$|Params$/.test(key) && item && typeof item === "object") localizeResponseMessages(item);
  return value;
}

async function fetchJson(url, options = {}) {
  // Capture the context of the displayed/prepared data before any asynchronous work.
  // Fetching a CSRF token must never upgrade an old draft into a different account.
  const writeContext = options.writeContext ?? state.overview?.settings?.writeContext;
  if (isUnsafeRequest(options)) await ensureCsrfToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      ...(isUnsafeRequest(options) ? { "X-CSRF-Token": state.csrfToken } : {}),
      ...(isUnsafeRequest(options) && writeContext ? { "X-Portal-Context": writeContext } : {}),
      ...(options.headers || {}),
    },
  });
  const body = localizeResponseMessages(await response.json());
  rememberCsrfToken(body);
  if (!response.ok) {
    const error = new Error(body.error || body.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function requestMethod(options = {}) {
  return String(options.method || "GET").toUpperCase();
}

function isUnsafeRequest(options = {}) {
  return !["GET", "HEAD", "OPTIONS"].includes(requestMethod(options));
}

function rememberCsrfToken(body) {
  const token = body?.csrfToken || body?.settings?.csrfToken || body?.overview?.settings?.csrfToken;
  if (token) state.csrfToken = token;
}

async function ensureCsrfToken() {
  if (state.csrfToken) return;
  const response = await fetch("/api/status", {
    headers: { "Accept": "application/json" },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
  rememberCsrfToken(body);
}


function isCurrentWriteContext(writeContext) {
  return writeContext === state.overview?.settings?.writeContext;
}

function invalidateExtensionBatch() {
  extensionBatchRequestGeneration += 1;
  state.extensionBatchPlan = null;
  state.extensionBatchLoading = false;
}

function resetAccountScopedState() {
  overviewRequestGeneration += 1;
  serviceRequestGeneration += 1;
  flowUndoHistory.length = 0;
  state.overview = null;
  state.flow = null;
  state.selectedExtensionId = "";
  state.selectedDidId = "";
  state.selectedNodeId = "";
  state.selectedNodeIds = [];
  state.selectedBranchField = "";
  state.actionPlan = null;
  phonebookRequestGeneration += 1;
  state.phonebookSyncLoading = false;
  state.phonebookManualRows = [];
  state.phonebookManualDraft = { firstName: "", name: "", phone: "" };
  state.phonebookManualDirty = false;
  state.phonebookUploadFeedback = null;
  state.daynightGatewayLoading = false;
  state.daynightAnnouncementLoading = false;
  invalidateExtensionBatch();
  state.extensionBatchRows = [emptyExtensionBatchRow()];
  state.daynightGatewayPreview = null;
  state.daynightOperationFeedback = null;
  state.profileTargetValue = "";
  state.daynightAnnouncementName = "";
  state.daynightAnnouncementAfterValue = "";
  state.daynightAnnouncementDisplayName = "";
  state.daynightAnnouncementDisplayNameEdited = false;
  state.daynightUseAnnouncement = false;
  state.daynightAnnouncementSource = "existing";
  state.serviceGroups = null;
  state.serviceDraft = null;
  state.serviceDraftHistory = [];
  state.selectedServiceKey = "";
  state.serviceFeedback = null;
}


async function loadOverview() {
  const generation = ++overviewRequestGeneration;
  state.loading = true;
  state.error = "";
  renderStatus();
  renderSettingsSummary();
  $("#view-callflow")?.toggleAttribute("inert", true);
  renderFlowFeedback();

  try {
    const overview = await fetchJson("/api/overview");
    if (generation !== overviewRequestGeneration) return;
    overview.demoFallback = buildDemoOverview(overview);
    state.overview = overview;
    state.authLoginMode = overview.settings?.authMode || state.authLoginMode;
    state.browserLoginDraft.baseUrl = overview.settings?.baseUrl || state.browserLoginDraft.baseUrl;
    if (overview.settings?.configured) {
      state.browserLoginDraft.customerAccount = overview.settings?.account || state.browserLoginDraft.customerAccount;
    }
    syncDaynightActiveFromOverview(overview);

    const firstExtension = getOverview()?.inventory?.extensions?.[0];
    const firstDid = getOverview()?.inventory?.dids?.[0];
    state.selectedExtensionId ||= firstExtension?.id || "";
    state.selectedDidId ||= firstDid?.id || "";
    const baseFlow = applyStoredFlowLayout(buildFlowForDid(selectedDid(), getOverview()), selectedDid());
    flowUndoHistory.length = 0;
    state.flow = applyStoredFlowDraft(applyStoredAppliedFlow(baseFlow, selectedDid()), selectedDid());
    state.selectedNodeId = "";
    state.selectedNodeIds = [];
    state.inspectorOpen = false;
    state.selectedBranchField = "";
  } catch (error) {
    if (generation !== overviewRequestGeneration) return;
    state.error = error.message;
  } finally {
    if (generation !== overviewRequestGeneration) return;
    state.loading = false;
    $("#view-callflow")?.toggleAttribute("inert", false);
    render();
    if (!state.serviceGroups && !state.serviceLoading) {
      loadServiceGroups({ quiet: true });
    }
  }
}

async function setLiveWritesEnabled(enabled) {
  if (state.liveWritesSaving || getOverview()?.settings?.liveWritesLocked) return;
  if (STATIC_DEMO_MODE) {
    showUiNotice({title:liveWritesDisabledTitle(),message:liveWritesDisabledText(),type:'warning'});
    return;
  }

  state.liveWritesSaving = true;
  renderSettingsSummary();
  renderPhonebookSync();
  try {
    const result = await fetchJson("/api/settings/live-writes", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
    if (state.overview) state.overview.settings = result.settings;
    render();
  } catch (error) {
    showUiNotice({ title: portalMessage("portal.settingNotSaved", "Setting not saved"), message: error.message });
  } finally {
    state.liveWritesSaving = false;
    render();
  }
}

function serviceDraftStorageKey() {
  const account = getOverview()?.account || state.overview?.account || "demo";
  return `${SERVICE_DRAFT_STORAGE_KEY}:${account}`;
}

function serviceKey(kind, service) {
  const id = service?.serviceNumber || service?.extensionNumber || service?.value || service?.id || service?.name;
  return `${kind}:${id}`;
}

function serviceId(service) {
  return service?.serviceNumber || service?.extensionNumber || service?.value || service?.id || "";
}

function serviceTypeFromMode(mode = state.serviceMode) {
  return mode === "skills" ? "skill" : "queue";
}

function serviceCollectionFromKind(kind) {
  return kind === "skill" ? "skills" : "queues";
}

function serviceCreateDraftFor(kind = serviceTypeFromMode()) {
  const collection = serviceCollectionFromKind(kind);
  if (!state.serviceCreateDrafts) state.serviceCreateDrafts = {};
  if (!state.serviceCreateDrafts[collection]) {
    state.serviceCreateDrafts[collection] = { displayName: "", serviceNumber: "", extensionNumber: "" };
  }
  return state.serviceCreateDrafts[collection];
}

function updateServiceCreateDraft(kind, field, value) {
  const draft = serviceCreateDraftFor(kind);
  draft[field] = value;
}

function resetServiceCreateDraft(kind = serviceTypeFromMode()) {
  state.serviceCreateDrafts[serviceCollectionFromKind(kind)] = { displayName: "", serviceNumber: "", extensionNumber: "" };
}

function defaultServiceColor(kind, service, index = 0) {
  const seed = String(service?.name || serviceId(service) || `${kind}-${index}`);
  let score = kind === "skill" ? 3 : 0;
  for (const char of seed) score += char.charCodeAt(0);
  return SERVICE_COLOR_PALETTE[score % SERVICE_COLOR_PALETTE.length].id;
}

function serviceColorDefinition(colorId) {
  return SERVICE_COLOR_PALETTE.find((item) => item.id === colorId) || SERVICE_COLOR_PALETTE[0];
}

function serviceColorStyle(colorId) {
  const color = serviceColorDefinition(colorId);
  return `--service-accent:${color.accent};--service-soft:${color.soft};`;
}

function serviceNumberMeta(entry) {
  const extension = String(entry?.extensionNumber || entry?.value || "").trim();
  const service = String(entry?.serviceNumber || entry?.id || "").trim();
  const parts = [];
  if (extension) parts.push(portalMessage("portal.extensionValue", "Extension {p0}", { p0: extension }));
  if (service && service !== extension) parts.push(portalMessage("portal.serviceValue", "Service {number}", { number: service }));
  return parts.join(" · ");
}

function serviceMemberCount(kind, service) {
  const entry = service ? existingServiceDraftEntry(kind, service) : null;
  return (entry?.members || service?.members || []).length;
}

function serviceMemberSummaries(kind, service) {
  const entry = service ? existingServiceDraftEntry(kind, service) : null;
  return (entry?.members || service?.members || []).map((member) => {
    const number = member.extensionNumber || member.id || "";
    const name = member.name || portalMessage("portal.extension", "Extension");
    return {
      number,
      name,
      label: [number, name].filter(Boolean).join(" "),
    };
  }).filter(Boolean);
}

function serviceMetaFor(kind, service) {
  if (!service) return {};
  const entry = existingServiceDraftEntry(kind, service);
  const colorId = entry?.color || service.color || defaultServiceColor(kind, service);
  const color = serviceColorDefinition(colorId);
  return {
    serviceKind: kind,
    serviceColor: colorId,
    serviceAccent: color.accent,
    serviceSoft: color.soft,
    memberCount: serviceMemberCount(kind, service),
    memberNames: serviceMemberSummaries(kind, service).map((member) => member.label),
    memberTargets: serviceMemberSummaries(kind, service),
  };
}

function findServiceForTarget(type, routeNumber = "", targetNumber = "", title = "") {
  const kind = ["GROUP", "SKILL"].includes(normalizeTargetType(type)) ? "skill" : "queue";
  const candidates = state.serviceGroups?.[serviceCollectionFromKind(kind)] || getOverview()?.inventory?.[serviceCollectionFromKind(kind)] || [];
  const route = String(routeNumber || "").trim();
  const target = String(targetNumber || "").trim();
  const name = String(title || "").trim().toLowerCase();
  return candidates.find((service) => {
    const id = String(serviceId(service)).trim();
    const extension = String(service.extensionNumber || service.value || "").trim();
    const serviceName = String(service.name || "").trim().toLowerCase();
    return (route && (id === route || extension === route))
      || (target && (extension === target || id === target))
      || (name && serviceName === name);
  }) || null;
}

function serviceMetaForTarget(type, routeNumber = "", targetNumber = "", title = "") {
  const normalized = normalizeTargetType(type);
  if (!["QUEUE", "GROUP", "SKILL"].includes(normalized)) return {};
  const service = findServiceForTarget(normalized, routeNumber, targetNumber, title);
  if (!service) return {};
  return serviceMetaFor(["GROUP", "SKILL"].includes(normalized) ? "skill" : "queue", service);
}

function refreshFlowServiceNodeMeta() {
  if (!state.flow?.nodes?.length || !state.serviceGroups) return;
  for (const node of state.flow.nodes) {
    const serviceRef = serviceForFlowNode(node);
    if (serviceRef) updateServiceNodeMeta(node, serviceRef);
  }
}

function nodeServiceMeta(node) {
  if (!node) return {};
  const normalized = normalizeTargetType(node.type);
  if (!["QUEUE", "GROUP", "SKILL"].includes(normalized)) return {};
  const serviceKind = ["GROUP", "SKILL"].includes(normalized) ? "skill" : "queue";
  const liveService = findServiceForTarget(normalized, node.routeNumber, node.targetNumber, node.title);
  const fromService = liveService ? serviceMetaFor(serviceKind, liveService) : {};
  const useLiveMembers = Boolean(liveService);
  const nodeMemberCount = Number.isFinite(Number(node.memberCount)) ? Number(node.memberCount) : fromService.memberCount;
  const nodeMemberNames = Array.isArray(node.memberNames) && node.memberNames.length ? node.memberNames : fromService.memberNames;
  const nodeMemberTargets = Array.isArray(node.memberTargets) && node.memberTargets.length ? node.memberTargets : fromService.memberTargets;
  const fromNode = {
    serviceKind: node.serviceKind || fromService.serviceKind,
    serviceColor: node.serviceColor || fromService.serviceColor,
    serviceAccent: node.serviceAccent || fromService.serviceAccent,
    serviceSoft: node.serviceSoft || fromService.serviceSoft,
    memberCount: useLiveMembers ? fromService.memberCount : nodeMemberCount,
    memberNames: useLiveMembers ? fromService.memberNames : nodeMemberNames,
    memberTargets: useLiveMembers ? fromService.memberTargets : nodeMemberTargets,
  };
  if (!fromNode.serviceAccent && fromNode.serviceColor) {
    const color = serviceColorDefinition(fromNode.serviceColor);
    fromNode.serviceAccent = color.accent;
    fromNode.serviceSoft = color.soft;
  }
  return fromNode;
}

function readStoredServiceDraft() {
  try {
    return JSON.parse(portalStorage.getItem(serviceDraftStorageKey()) || "null");
  } catch {
    return null;
  }
}

function writeStoredServiceDraft(draft) {
  portalStorage.setItem(serviceDraftStorageKey(), JSON.stringify(draft));
}

function cloneServiceDraft(draft = state.serviceDraft) {
  return draft ? JSON.parse(JSON.stringify(draft)) : null;
}

function rememberServiceDraftChange() {
  const snapshot = cloneServiceDraft();
  if (!snapshot) return;
  state.serviceDraftHistory = [...(state.serviceDraftHistory || []), snapshot].slice(-10);
}

function undoServiceDraftChange() {
  const history = state.serviceDraftHistory || [];
  const previous = history.pop();
  state.serviceDraftHistory = history;
  if (!previous) {
    state.serviceFeedback = { type: "info", title: portalMessage("portal.nothingToUndo", "Nothing to undo"), message: portalMessage("portal.thereIsNoLocalChangeToUndo", "There is no local change to undo.") };
    renderServices();
    return;
  }
  state.serviceDraft = previous;
  writeStoredServiceDraft(state.serviceDraft);
  refreshFlowServiceNodeMeta();
  state.serviceFeedback = { type: "info", title: portalMessage("portal.undo", "Undo"), message: portalMessage("portal.theLastLocalChangeWasUndone", "The last local change was undone.") };
  renderServices();
  if (state.view === "callflow") renderCallflow();
}

function memberFromExtension(extension, kind) {
  return {
    extensionNumber: extension.number || extension.id,
    name: extension.name || portalMessage("portal.extensionValue", "Extension {p0}", { p0: extension.number || extension.id }),
    type: extension.type || "PHONE",
    penalty: 0,
    skillLevel: 1,
    enabled: true,
    kind,
  };
}

function buildServiceDraft(groups = state.serviceGroups) {
  const draft = {
    queues: {},
    skills: {},
    updatedAt: new Date().toISOString(),
    account: groups?.account || getOverview()?.account || "",
  };
  ["queues", "skills"].forEach((collection) => {
    const kind = collection === "skills" ? "skill" : "queue";
    (groups?.[collection] || []).forEach((service, index) => {
      const key = serviceId(service);
      if (!key) return;
      draft[collection][key] = {
        kind,
        serviceNumber: key,
        name: service.name,
        baseRevision: service.memberRevision || "",
        baseMembers: clone(service.members || []),
        color: service.color || defaultServiceColor(kind, service, index),
        members: (service.members || []).map((member) => ({
          extensionNumber: member.extensionNumber || member.id,
          name: member.name,
          type: member.type,
          penalty: Number(member.penalty || 0),
          skillLevel: Number(member.skillLevel || 1),
          enabled: member.enabled !== false,
        })),
      };
    });
  });
  return draft;
}

function reconcileServiceDraft(groups, stored) {
  const fresh = buildServiceDraft(groups);
  state.serviceDraftConflicts = stored?.conflicts || [];
  if (!stored || stored.account !== fresh.account) return fresh;
  for (const collection of ["queues", "skills"]) for (const [id, entry] of Object.entries(fresh[collection])) {
    const previous = stored[collection]?.[id];
    // A draft may survive reload only against the exact membership snapshot it was based on.
    if (entry.baseRevision && previous?.baseRevision === entry.baseRevision) fresh[collection][id] = previous;
    else if (previous && (membershipDelta(previous).add.length || membershipDelta(previous).remove.length || membershipDelta(previous).update.length)) state.serviceDraftConflicts.push({collection,id,previous});
  }
  for (const collection of ["queues", "skills"]) for (const [id, previous] of Object.entries(stored[collection] || {})) if (!fresh[collection][id] && (membershipDelta(previous).add.length || membershipDelta(previous).remove.length || membershipDelta(previous).update.length)) state.serviceDraftConflicts.push({collection,id,previous});
  state.serviceDraftConflicts = state.serviceDraftConflicts.filter((entry,index,all) => all.findIndex(item=>item.collection===entry.collection && item.id===entry.id)===index);
  fresh.conflicts = state.serviceDraftConflicts;
  return fresh;
}

function membershipDelta(entry) {
  const base = new Map((entry.baseMembers || []).map(member => [String(member.extensionNumber || member.id), member]));
  const desired = new Map((entry.members || []).map(member => [String(member.extensionNumber || member.id), member]));
  const settings = member => JSON.stringify([Number(member.penalty || 0), Number(member.skillLevel || 1), member.enabled !== false]);
  return {
    baseRevision: entry.baseRevision,
    add: [...desired].filter(([id]) => !base.has(id)).map(([,member]) => member),
    remove: [...base.keys()].filter(id => !desired.has(id)),
    update: [...desired].filter(([id,member]) => base.has(id) && settings(member) !== settings(base.get(id))).map(([,member]) => member),
  };
}

function flowMembershipChanges(flow) {
  const reachable = reachableFlowNodeIds(flow);
  const services = [], seen = new Set();
  for (const node of flow?.nodes || []) {
    if (!reachable.has(node.id) || node.config?.portalMode === "new") continue;
    const ref = serviceForFlowNode(node);
    if (!ref) continue;
    const key = serviceKey(ref.kind, ref.service);
    const entry = existingServiceDraftEntry(ref.kind, ref.service);
    if (!entry || seen.has(key)) continue;
    seen.add(key);
    const delta = membershipDelta(entry);
    if (delta.add.length || delta.remove.length || delta.update.length) {
      services.push({ kind: ref.kind, serviceNumber: entry.serviceNumber, ...delta });
    }
  }
  return { account: state.serviceGroups?.account, services };
}

function recordFlowMembershipReadback(groups, services, submittedDraft = null) {
  const fresh = buildServiceDraft(groups);
  const draft = cloneServiceDraft() || fresh;
  if (draft.account !== fresh.account) return;
  for (const {kind, serviceNumber} of services) {
    const collection = serviceCollectionFromKind(kind);
    const previous = draft[collection]?.[serviceNumber];
    const entry = fresh[collection]?.[serviceNumber];
    if (!previous || !entry?.baseRevision) continue;
    // Rebase only this Apply's touched services against its readback. Completed
    // operations disappear from the delta; unfinished/new edits remain drafts.
    // After a successful Services Apply, only edits made after its submitted
    // intent remain pending. Partial Callflow readback keeps its original base.
    const baseMembers = submittedDraft?.[collection]?.[serviceNumber]?.members || previous.baseMembers;
    const delta = membershipDelta({ ...previous, baseMembers });
    const members = new Map(entry.members.map(member => [String(member.extensionNumber), member]));
    delta.remove.forEach(id => members.delete(String(id)));
    delta.add.forEach(member => { if (!members.has(String(member.extensionNumber))) members.set(String(member.extensionNumber), member); });
    delta.update.forEach(member => { if (members.has(String(member.extensionNumber))) members.set(String(member.extensionNumber), member); });
    draft[collection][serviceNumber] = { ...entry, color: previous.color, members: [...members.values()] };
    for (const snapshot of state.serviceDraftHistory || []) {
      if (snapshot[collection]?.[serviceNumber]) snapshot[collection][serviceNumber] = clone(entry);
    }
  }
  state.serviceGroups = groups;
  state.serviceDraft = draft;
  writeStoredServiceDraft(draft);
  refreshFlowServiceNodeMeta();
}

function ensureServiceDraft() {
  if (!state.serviceDraft) {
    state.serviceDraft = reconcileServiceDraft(state.serviceGroups, readStoredServiceDraft());
  }
  return state.serviceDraft;
}

function existingServiceDraftEntry(kind, service) {
  const collection = serviceCollectionFromKind(kind);
  const key = serviceId(service);
  return state.serviceDraft?.[collection]?.[key] || null;
}

function serviceDraftEntry(kind, service) {
  const collection = serviceCollectionFromKind(kind);
  const key = serviceId(service);
  const draft = ensureServiceDraft();
  draft[collection] ||= {};
  draft[collection][key] ||= {
    kind,
    serviceNumber: key,
    name: service.name,
    color: defaultServiceColor(kind, service),
    members: [],
  };
  draft[collection][key].color ||= defaultServiceColor(kind, service);
  return draft[collection][key];
}

function selectedService() {
  const kind = serviceTypeFromMode();
  const services = state.serviceGroups?.[serviceCollectionFromKind(kind)] || [];
  const selected = services.find((service) => serviceKey(kind, service) === state.selectedServiceKey);
  return selected || null;
}

function selectedServiceDraft() {
  const service = selectedService();
  if (!service) return null;
  return serviceDraftEntry(serviceTypeFromMode(), service);
}

function serviceHasChanges(kind, service) {
  const entry = serviceDraftEntry(kind, service);
  const live = (service.members || []).map((member) => ({
    extensionNumber: member.extensionNumber || member.id,
    penalty: Number(member.penalty || 0),
    skillLevel: Number(member.skillLevel || 1),
    enabled: member.enabled !== false,
  })).sort((a, b) => String(a.extensionNumber).localeCompare(String(b.extensionNumber), undefined, { numeric: true }));
  const draft = (entry.members || []).map((member) => ({
    extensionNumber: member.extensionNumber || member.id,
    penalty: Number(member.penalty || 0),
    skillLevel: Number(member.skillLevel || 1),
    enabled: member.enabled !== false,
  })).sort((a, b) => String(a.extensionNumber).localeCompare(String(b.extensionNumber), undefined, { numeric: true }));
  return JSON.stringify(live) !== JSON.stringify(draft);
}

async function loadServiceGroups(options = {}) {
  const generation = ++serviceRequestGeneration;
  const quiet = Boolean(options.quiet);
  state.serviceLoading = true;
  if (!quiet) {
    state.serviceFeedback = { type: "info", title: portalMessage("portal.loading", "Loading"), message: portalMessage("portal.readingQueuesAndSkillGroupsFromThePortalApi", "Reading queues and skill groups from the Portal API.") };
    renderServices();
  }
  try {
    const groups = await fetchJson("/api/service-groups");
    if (generation !== serviceRequestGeneration) return;
    state.serviceGroups = groups;
    state.serviceDraft = reconcileServiceDraft(groups, readStoredServiceDraft());
    state.serviceDraftHistory = [];
    refreshFlowServiceNodeMeta();
    const kind = serviceTypeFromMode();
    const services = groups[serviceCollectionFromKind(kind)] || [];
    if (state.selectedServiceKey && !services.some((service) => serviceKey(kind, service) === state.selectedServiceKey)) {
      state.selectedServiceKey = "";
    }
    if (!quiet) {
      state.serviceFeedback = null;
    }
  } catch (error) {
    if (generation !== serviceRequestGeneration) return;
    if (!quiet || state.view === "services") {
      state.serviceFeedback = { type: "error", title: portalMessage("portal.loadingFailed", "Loading failed"), message: error.message };
    }
  } finally {
    if (generation !== serviceRequestGeneration) return;
    state.serviceLoading = false;
    if (quiet) {
      if (state.view === "callflow") renderCallflow();
      if (state.view === "services") {
        renderServices();
      }
    } else {
      renderServices();
    }
  }
}

function addServiceMember(kind, serviceId, extensionId) {
  addServiceMembers(kind, serviceId, [extensionId]);
}

function addServiceMembers(kind, serviceId, extensionIds = []) {
  const overview = getOverview();
  const services = state.serviceGroups?.[serviceCollectionFromKind(kind)] || [];
  const service = services.find((item) => String(item.serviceNumber || item.id || item.value) === String(serviceId));
  if (!service || service.memberError || !service.memberRevision) return;
  const entry = serviceDraftEntry(kind, service);
  const ids = new Set(extensionIds.map((item) => String(item)));
  const extensions = (overview?.inventory?.extensions || []).filter((item) => ids.has(String(item.id)) || ids.has(String(item.number)));
  if (!extensions.length) return;
  const existingNumbers = new Set((entry.members || []).map((member) => String(member.extensionNumber || member.number || member.id || "")));
  const hasNewMember = extensions.some((extension) => {
    const extensionNumber = extension.number || extension.id;
    return !existingNumbers.has(String(extensionNumber));
  });
  if (hasNewMember) rememberServiceDraftChange();
  let added = 0;
  for (const extension of extensions) {
    const extensionNumber = extension.number || extension.id;
    if ((entry.members || []).some((member) => String(member.extensionNumber) === String(extensionNumber))) continue;
    entry.members.push(memberFromExtension(extension, kind));
    added += 1;
  }
  if (added) {
    entry.members.sort((a, b) => String(a.extensionNumber).localeCompare(String(b.extensionNumber), undefined, { numeric: true }));
  }
  state.selectedServiceKey = serviceKey(kind, service);
  state.serviceInspectorOpen = false;
  state.selectedServiceExtensionIds = [];
  state.serviceFeedback = {
    type: added ? "info" : "success",
    title: added ? portalMessage("portal.draftChanged", "Draft changed") : portalMessage("portal.noChange", "No change"),
    message: added
      ? portalMessage("portal.valueExtensionsQueuedForValue", "{p0} extensions queued for {p3}.", { p0: added, p1: added === 1 ? "" : "n", p2: added === 1 ? "ist" : "sind", p3: service.name })
      : portalMessage("portal.theSelectedExtensionsWereAlreadyIncluded", "The selected extensions were already included."),
  };
  writeStoredServiceDraft(state.serviceDraft);
  renderServices();
}

function removeServiceMember(kind, serviceId, extensionNumber) {
  const services = state.serviceGroups?.[serviceCollectionFromKind(kind)] || [];
  const service = services.find((item) => String(item.serviceNumber || item.id || item.value) === String(serviceId));
  if (!service || service.memberError || !service.memberRevision) return;
  const entry = serviceDraftEntry(kind, service);
  const nextMembers = (entry.members || []).filter((member) => String(member.extensionNumber) !== String(extensionNumber));
  if (nextMembers.length === (entry.members || []).length) return;
  rememberServiceDraftChange();
  entry.members = nextMembers;
  state.serviceFeedback = { type: "info", title: portalMessage("portal.draftChanged", "Draft changed"), message: portalMessage("portal.membershipWillBeRemovedWhenTheChangesAreApplied", "Membership will be removed when the changes are applied.") };
  writeStoredServiceDraft(state.serviceDraft);
  renderServices();
}

function updateServiceMember(kind, serviceId, extensionNumber, patch) {
  const services = state.serviceGroups?.[serviceCollectionFromKind(kind)] || [];
  const service = services.find((item) => String(item.serviceNumber || item.id || item.value) === String(serviceId));
  if (!service || service.memberError || !service.memberRevision) return;
  const entry = serviceDraftEntry(kind, service);
  const member = (entry.members || []).find((item) => String(item.extensionNumber) === String(extensionNumber));
  if (!member) return;
  const hasChange = Object.entries(patch).some(([key, value]) => member[key] !== value);
  if (!hasChange) return;
  rememberServiceDraftChange();
  Object.assign(member, patch);
  state.serviceFeedback = { type: "info", title: portalMessage("portal.draftChanged", "Draft changed"), message: portalMessage("portal.server.membershipSettingQueued", "Membership setting queued.") };
  writeStoredServiceDraft(state.serviceDraft);
  renderServices();
}

function updateServiceColor(kind, targetServiceId, colorId) {
  const services = state.serviceGroups?.[serviceCollectionFromKind(kind)] || [];
  const service = services.find((item) => String(serviceId(item)) === String(targetServiceId));
  if (!service || !SERVICE_COLOR_PALETTE.some((color) => color.id === colorId)) return;
  const entry = serviceDraftEntry(kind, service);
  if (entry.color === colorId) return;
  rememberServiceDraftChange();
  entry.color = colorId;
  state.serviceFeedback = { type: "info", title: portalMessage("portal.colourSaved", "Colour saved"), message: portalMessage("portal.theColourIsUsedInTheGroupViewAnd", "The colour is used in the group view and callflow.") };
  writeStoredServiceDraft(state.serviceDraft);
  renderServices();
  if (state.view === "callflow") renderCallflow();
}

function validateServiceDraft(showSuccess = true) {
  const groups = state.serviceGroups;
  if (!groups) return { ok: false, message: portalMessage("portal.noServiceDataLoadedYet", "No service data loaded yet.") };
  const allServices = [
    ...(groups.queues || []).map((service) => ({ kind: "queue", service })),
    ...(groups.skills || []).map((service) => ({ kind: "skill", service })),
  ];
  const changed = allServices.filter(({ kind, service }) => !service.memberError && service.memberRevision && serviceHasChanges(kind, service));
  if (!changed.length) {
    state.serviceFeedback = { type: "info", title: portalMessage("portal.noChange", "No change"), message: portalMessage("portal.theDraftMatchesTheLiveState", "The draft matches the live state.") };
    renderServices();
    return { ok: false, message: portalMessage("portal.noChange_850e8", "No change.") };
  }
  const emptyService = changed.find(({ kind, service }) => !(serviceDraftEntry(kind, service).members || []).length);
  if (emptyService) {
    state.serviceFeedback = { type: "error", title: portalMessage("portal.checkFailed", "Check failed"), message: portalMessage("portal.valueWouldHaveNoMembersAfterwards", "{p0} would have no members afterwards.", { p0: emptyService.service.name }) };
    renderServices();
    return { ok: false, message: portalMessage("portal.server.emptyTargetGroup", "Empty target group.") };
  }
  if (showSuccess) {
    state.serviceFeedback = { type: "success", title: portalMessage("portal.draftReady", "Draft ready"), message: portalMessage("portal.valueServicesWithChangedMemberships", "{p0} services with changed memberships.", { p0: changed.length, p1: changed.length === 1 ? "" : "s" }) };
    renderServices();
  }
  return { ok: true, changed };
}

async function applyServiceDraft() {
  if (state.serviceApplying) return;
  if (!localApplyPermitted()) {
    state.serviceFeedback = { type: "error", title: portalMessage("portal.liveWritesDisabled", "Live writes disabled"), message: liveWritesDisabledText() };
    renderServices();
    return;
  }
  const validation = validateServiceDraft(false);
  if (!validation.ok) return;
  const names = validation.changed.map(({ service }) => service.name).join("\n");
  const writeContext = state.overview?.settings?.writeContext;
  const preparedDraft = state.serviceDraft;
  const draftSnapshot = JSON.stringify(preparedDraft);
  const current = () => isCurrentWriteContext(writeContext) && state.serviceDraft === preparedDraft;
  const payload = clone({
    account: state.serviceGroups.account,
    services: validation.changed.map(({ kind, service }) => {
      const entry = serviceDraftEntry(kind, service);
      return { kind, serviceNumber: entry.serviceNumber, ...membershipDelta(entry) };
    }),
  });
  state.serviceApplying = true;
  renderServices();
  try {
    const confirmed = await confirmUi({
      title: portalMessage("portal.applyChanges", "Apply changes"),
      message: portalMessage("portal.applyMembershipChanges", "Apply membership changes to these groups?\n{names}", { names }),
      confirmLabel: portalMessage("portal.apply", "Apply"),
    });
    if (!confirmed || !current() || !localApplyPermitted() || JSON.stringify(state.serviceDraft) !== draftSnapshot) return;
    state.serviceFeedback = { type: "info", title: portalMessage("portal.applyingChanges", "Applying changes"), message: portalMessage("portal.server.thePortalApiIsUpdatingMemberships", "The Portal API is updating memberships.") };
    renderServices();
    if (!localWritesEnabled()) {
      const result = await fetchJson("/api/settings/live-writes", {
        method: "POST", writeContext, body: JSON.stringify({ enabled: true }),
      });
      if (!current() || !localApplyPermitted() || JSON.stringify(state.serviceDraft) !== draftSnapshot) return;
      if (result.ok === false || result.settings?.writeContext !== writeContext) throw new Error(result.message || liveWritesDisabledText());
      state.overview.settings = result.settings;
      if (!localWritesEnabled()) throw new Error(liveWritesDisabledText());
    }
    const result = await fetchJson("/api/service-groups/apply", { method: "POST", writeContext, body: JSON.stringify(payload) });
    if (!current()) return;
    if (result.overview) state.overview = result.overview;
    if (JSON.stringify(state.serviceDraft) === draftSnapshot) {
      state.serviceGroups = result.serviceGroups;
      state.serviceDraft = buildServiceDraft(result.serviceGroups);
      state.serviceDraftHistory = [];
      writeStoredServiceDraft(state.serviceDraft);
    } else {
      recordFlowMembershipReadback(result.serviceGroups, payload.services, JSON.parse(draftSnapshot));
    }
    state.serviceFeedback = { type: "success", title: result.title || portalMessage("portal.applied", "Applied"), message: result.message || portalMessage("portal.changesApplied", "Changes applied.") };
    render();
  } catch (error) {
    if (!current()) return;
    const partial = error.body;
    if (partial?.completed) await loadServiceGroups({quiet:true});
    if (!isCurrentWriteContext(writeContext)) return;
    state.serviceFeedback = { type: "error", title: portalMessage("portal.applyingChangesFailed", "Applying changes failed"), message: error.message, operations: partial?.completed ? partial : null };
    renderServices();
  } finally { state.serviceApplying = false; renderServices(); }
}

function buildDemoOverview(base = {}) {
  const extensions = [
    { id: "201", number: "201", name: "Reception", type: "PHONE", email: "reception@example.local", device: "Yealink T54W" },
    { id: "202", number: "202", name: "Sales", type: "PHONE", email: "sales@example.local", device: "Softphone" },
    { id: "203", number: "203", name: "Support", type: "PHONE", email: "support@example.local", device: "Yealink T46S" },
  ];
  const overview = {
    ...base,
    settings: { ...base.settings, liveWritesEnabled: false, liveWritesLocked: true },
    ok: true,
    demo: true,
    account: base.account || "Demo",
    version: { version: "Demo" },
    counts: {
      extensions: extensions.length,
      devices: 4,
      trunks: 1,
      dids: 3,
      phoneBooks: 2,
      groups: 1,
      queues: 1,
      skills: 1,
      ivrs: 1,
      timeControls: 1,
      announcements: 1,
    },
    inventory: {
      extensions,
      devices: [{ id: "softphone", name: "Softphone", value: "202" }, { id: "deskphone", name: "Deskphone", value: "201" }],
      trunks: [{ id: "trunk", name: "Main SIP Trunk", value: "+49 89 12345-0" }],
      dids: [
        { id: "+49 89 12345-0", name: "+49 89 12345-0", value: "Reception", destinationName: "Reception", destinationExtension: "201", destinationType: "PHONEEXTENSION", trunkNumber: "+49 89 12345(0-9)" },
        { id: "+49 89 12345-1", name: "+49 89 12345-1", value: "Sales", destinationName: "Sales", destinationExtension: "202", destinationType: "PHONEEXTENSION", trunkNumber: "+49 89 12345(0-9)" },
        { id: "+49 89 12345-2", name: "+49 89 12345-2", value: "Support", destinationName: "Support", destinationExtension: "203", destinationType: "PHONEEXTENSION", trunkNumber: "+49 89 12345(0-9)" },
      ],
      phoneBooks: [{ id: "phonebook", name: "Company" }],
      groups: [{ id: "10", name: "Reception Group" }],
      queues: [{ id: "10000", name: "Demo Frontdesk", value: "10000" }],
      skills: [{ id: "11", name: "Demo Skill", value: "11" }],
      ivrs: [{ id: "20", name: portalMessage("portal.server.welcomeVoiceDialog", "Welcome voice dialog") }],
      timeControls: [{ id: "30", name: "Business Hours" }],
      announcements: [{ id: "40", name: portalMessage("portal.server.nightAnnouncement", "Night announcement"), value: "GENERAL_ANNOUNCEMENT" }],
    },
    endpoints: {},
    syncedAt: new Date().toISOString(),
  };
  overview.callflow = buildFlowForDid(overview.inventory.dids[0], overview);
  return overview;
}

function buildDemoFlow(overview) {
  return buildFlowForDid(overview.inventory?.dids?.[0], overview);
}

function targetTypeLabel(type) {
  const labels = {
    PHONEEXTENSION: portalMessage("portal.extension", "Extension"),
    PHONE: portalMessage("portal.extension", "Extension"),
    QUEUE: portalMessage("portal.queue", "Queue"),
    GROUP: portalMessage("portal.skillGroup", "Skill group"),
    SKILL: portalMessage("portal.skillGroup", "Skill group"),
    VOICEMAIL: portalMessage("portal.voicemail", "Voicemail"),
    FRONTDESK: "Frontdesk",
    IVR: portalMessage("portal.voiceDialog", "Voice dialog"),
    TIMECONTROL: portalMessage("portal.timeControl", "Time control"),
    ANNOUNCEMENT: portalMessage("portal.announcement", "Announcement"),
    HANGUP: portalMessage("portal.hangUp", "Hang up"),
    NEW_NIGHT_TARGET: portalMessage("portal.newNightTarget", "New night target"),
    PLACEHOLDER: portalMessage("portal.unconfiguredStep", "Unconfigured step"),
    UNASSIGNED: portalMessage("portal.noTarget", "No target"),
    TRUNK: portalMessage("portal.line", "Line"),
  };
  return labels[String(type || "").toUpperCase()] || portalMessage("portal.destination", "Destination");
}

function displayTargetName(type, name) {
  return String(name || "");
}

function targetNumberFromText(value) {
  const text = String(value || "");
  // A schedule describes a time window, never a destination extension.
  if (/\b\d{1,2}:\d{2}\b/.test(text)) return "";
  const match = text.match(/\b\d{1,8}\b/);
  return match ? match[0] : "";
}

function targetOptionLabel(number, type, name) {
  return `${number || "-"} - (${targetTypeLabel(type)} | ${displayTargetName(type, name) || portalMessage("portal.unnamed", "Unnamed")})`;
}

function targetOptionSortValue(target) {
  let parsed = {};
  try {
    parsed = JSON.parse(target.value);
  } catch {
    parsed = {};
  }
  const number = Number.parseInt(parsed.targetNumber || parsed.routeNumber || "", 10);
  const typeOrder = { QUEUE: 1, IVR: 2, FRONTDESK: 3, VOICEMAIL: 4, PHONEEXTENSION: 5, PHONE: 5, GROUP: 6, SKILL: 6, TIMECONTROL: 7, TRUNK: 8 };
  return {
    number: Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER,
    type: typeOrder[String(parsed.type || target.kind || "").toUpperCase()] || 99,
    title: String(parsed.title || target.label || "").toLowerCase(),
  };
}

function compareTargetOptions(left, right) {
  const a = targetOptionSortValue(left);
  const b = targetOptionSortValue(right);
  return a.number - b.number || a.type - b.type || a.title.localeCompare(b.title, portalLocale());
}

function cubicPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return (mt ** 3) * p0 + 3 * (mt ** 2) * t * p1 + 3 * mt * (t ** 2) * p2 + (t ** 3) * p3;
}

function cubicTangent(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return 3 * (mt ** 2) * (p1 - p0) + 6 * mt * t * (p2 - p1) + 3 * (t ** 2) * (p3 - p2);
}

function smoothRatio(primary, secondary) {
  const total = Math.max(1, primary + secondary);
  const raw = primary / total;
  return raw * raw * (3 - 2 * raw);
}

function targetTone(type) {
  const tones = {
    PHONEEXTENSION: "green",
    PHONE: "green",
    QUEUE: "amber",
    GROUP: "teal",
    SKILL: "teal",
    VOICEMAIL: "purple",
    FRONTDESK: "blue",
    IVR: "coral",
    TIMECONTROL: "teal",
    ANNOUNCEMENT: "coral",
    HANGUP: "muted",
    PLACEHOLDER: "muted",
    TRUNK: "purple",
    DID: "indigo",
  };
  return tones[String(type || "").toUpperCase()] || "green";
}

function ivrInventoryKey(ivr) {
  return String(ivr?.serviceNumber || ivr?.id || ivr?.extensionNumber || ivr?.value || "").trim();
}

function inventoryIvrForTarget(target, routeNumber = "", targetNumber = "") {
  const route = String(routeNumber || target?.routeNumber || target?.serviceNumber || target?.id || "").trim();
  const extension = String(targetNumber || target?.targetNumber || target?.extensionNumber || target?.value || "").trim();
  return (getOverview()?.inventory?.ivrs || []).find((ivr) => {
    const serviceNumber = String(ivr.serviceNumber || ivr.id || "").trim();
    const extensionNumber = String(ivr.extensionNumber || ivr.value || "").trim();
    return (route && (serviceNumber === route || extensionNumber === route))
      || (extension && (extensionNumber === extension || serviceNumber === extension));
  }) || null;
}

function flowTargetFromApiTarget(target, seenIvrs = new Set()) {
  if (!target) return null;
  const type = normalizeTargetType(target.type);
  const targetNumber = target.targetNumber || target.number || target.extensionNumber || "";
  const routeNumber = target.routeNumber || target.serviceNumber || targetNumber || "";
  const normalized = {
    type,
    title: target.title || target.name || targetTypeLabel(type),
    subtitle: target.subtitle || (targetNumber ? `${targetTypeLabel(type)} ${targetNumber}` : targetTypeLabel(type)),
    targetNumber,
    routeNumber,
    tone: target.tone || targetTone(type),
    ...serviceMetaForTarget(type, routeNumber, targetNumber, target.title || target.name),
  };
  const subtitleKey = { QUEUE: "portal.queueValue", SKILL: "portal.skillGroupValue" }[type];
  if (subtitleKey && targetNumber) {
    const generatedLabels = Object.values(window.NFON_MESSAGES?.[subtitleKey] || {})
      .filter(value => typeof value === "string").map(value => value.replace(/\{p0\}/g, targetNumber));
    if (generatedLabels.includes(normalized.subtitle)) normalized._i18nDefaults = {
      subtitle: { key: subtitleKey, params: { p0: targetNumber }, value: normalized.subtitle },
    };
  }
  ["serviceKind", "serviceColor", "serviceAccent", "serviceSoft", "memberCount", "memberNames", "memberTargets"].forEach((key) => {
    if (target[key] !== undefined && target[key] !== "") normalized[key] = target[key];
  });
  if (type === "HANGUP") {
    setFlowNodeDefault(normalized, "title", { key: "portal.hangUp", fallback: "Hang up" });
    setFlowNodeDefault(normalized, "subtitle", { key: "portal.endCall", fallback: "End call" });
  }
  if (type === "IVR") {
    const liveIvr = inventoryIvrForTarget(target, routeNumber, targetNumber);
    const liveKey = liveIvr ? `IVR:${ivrInventoryKey(liveIvr)}` : "";
    normalized.config = { portalMode: "existing", ivrKeys: [], ivrKeysVerified: true };
    if (liveIvr && liveKey && !seenIvrs.has(liveKey)) {
      normalized.title = liveIvr.name || normalized.title;
      normalized.subtitle = liveIvr.extensionNumber ? portalMessage("portal.voiceDialogValue", "Voice dialog {p0}", { p0: liveIvr.extensionNumber }) : normalized.subtitle;
      normalized.targetNumber = liveIvr.extensionNumber || normalized.targetNumber;
      normalized.routeNumber = liveIvr.serviceNumber || normalized.routeNumber;
      normalized.config = liveIvrConfig(liveIvr, seenIvrs);
    }
  }
  if (type === "TIMECONTROL") {
    const control = (getOverview()?.inventory?.timeControls || []).find(item =>
      [item.serviceNumber, item.id, item.value, item.extensionNumber].some(value => value != null && [String(routeNumber), String(targetNumber)].includes(String(value))));
    normalized.config = { portalMode: "existing" };
    const key = control ? `TIMECONTROL:${control.serviceNumber || control.id || control.value}` : "";
    if (control && !control.detailError && !seenIvrs.has(key)) {
      const seen = new Set([...seenIvrs, key]);
      normalized.config = { ...normalized.config, branchSource: "verified-live",
        hours: control.hours || "",
        timezoneHref: control.timezoneHref || "", evaluationStrategy: control.evaluationStrategy || "",
        openTarget: flowTargetFromApiTarget(control.dayTarget || flowApiTargetFromHref(control.dayTargetHref), seen),
        closedTarget: flowTargetFromApiTarget(control.nightTarget || flowApiTargetFromHref(control.nightTargetHref), seen) };
    }
  }
  return normalized;
}

// Retained local/demo snapshots may only have provider links, without hydrated target objects.
function flowApiTargetFromHref(href) {
  const value = String(href || "");
  if (!value) return null;
  if (/\/HANGUP$/i.test(value)) return { type: "HANGUP", routeNumber: "HANGUP" };
  const collections = { "phone-extensions": ["PHONEEXTENSION", "extensions"], "ivr-services": ["IVR", "ivrs"],
    "time-control-services": ["TIMECONTROL", "timeControls"], "queue-services": ["QUEUE", "queues"] };
  const match = value.match(/\/([^/]+)\/([^/]+)\/?$/);
  const entry = match && collections[match[1]];
  if (!entry) return null;
  const item = (getOverview()?.inventory?.[entry[1]] || []).find(item =>
    item.href === value || [item.serviceNumber, item.id, item.value, item.extensionNumber, item.number].some(number => String(number) === match[2]));
  return { type: entry[0], routeNumber: item?.serviceNumber || match[2],
    targetNumber: item?.extensionNumber || item?.number || item?.value || match[2], title: item?.name || "" };
}

function liveIvrForDid(did, overview) {
  if (normalizeTargetType(did?.destinationType) !== "IVR") return null;
  const serviceNumber = did.destinationServiceNumber || "";
  const extensionNumber = did.destinationExtension || "";
  return (overview?.inventory?.ivrs || []).find((ivr) => {
    return (serviceNumber && (ivr.serviceNumber === serviceNumber || ivr.id === serviceNumber || ivr.value === serviceNumber))
      || (extensionNumber && (ivr.extensionNumber === extensionNumber || ivr.value === extensionNumber));
  }) || null;
}

function liveIvrConfig(ivr, seenIvrs = new Set()) {
  const nextSeenIvrs = new Set(seenIvrs);
  const currentKey = ivrInventoryKey(ivr);
  if (currentKey) nextSeenIvrs.add(`IVR:${currentKey}`);
  const keys = (ivr?.keyRoutes || [])
    .map((route) => String(route.number || ""))
    .filter(Boolean);
  const config = {
    portalMode: "existing",
    announcement: ivr?.announcement || "",
    ivrKeys: keys,
    branchSource: "verified-live",
    ivrKeysVerified: true,
    timeoutSeconds: ivr?.timeoutSeconds || "20",
  };
  for (const route of ivr?.keyRoutes || []) {
    const key = String(route.number || "");
    const target = flowTargetFromApiTarget(route.target, nextSeenIvrs);
    if (key && target) config[ivrTargetField(key)] = target;
  }
  const timeoutTarget = flowTargetFromApiTarget(ivr?.timeoutTarget, nextSeenIvrs);
  if (timeoutTarget) config.timeoutTarget = timeoutTarget;
  return config;
}

function flowProviderSignature(value) {
  if (Array.isArray(value)) return value.map(flowProviderSignature);
  if (!value || typeof value !== "object") return value;
  const presentation = new Set(["title", "subtitle", "name", "tone", "x", "y", "id", "_i18nDefaults", "serviceColor", "serviceAccent", "serviceSoft", "memberNames", "memberCount", "memberTargets"]);
  return Object.fromEntries(Object.keys(value).sort().filter(key => !presentation.has(key))
    .map(key => [key, flowProviderSignature(value[key])]));
}

function buildFlowForDid(did, overview) {
  const selected = did || overview?.inventory?.dids?.[0];
  if (!selected) return { nodes: [], edges: [], source: overview?.demo ? "demo" : "portal-live" };
  const trunk = selected.trunkNumber || overview?.inventory?.trunks?.[0]?.name || "SIP Trunk";
  const destinationTitle = selected.destinationName || selected.value || selected.destinationExtension || portalMessage("portal.selectTarget", "Select target");
  const destinationSubtitle = selected.destinationExtension
    ? `${targetTypeLabel(selected.destinationType)} ${selected.destinationExtension}`
    : targetTypeLabel(selected.destinationType);
  const targetNode = {
    id: "target", x: 46, y: 54,
    ...flowTargetFromApiTarget({ type: selected.destinationType || "PHONEEXTENSION",
      title: destinationTitle, subtitle: destinationSubtitle,
      targetNumber: selected.destinationExtension || "",
      routeNumber: selected.destinationServiceNumber || selected.destinationExtension || "" }),
  };
  targetNode.isTarget = !["IVR", "TIMECONTROL"].includes(normalizeTargetType(targetNode.type));
  // Revision contains routing content only: refresh timestamps and translated labels
  // must not invalidate a local draft. Provider branch/config changes must.
  const providerRevision = JSON.stringify(flowProviderSignature({
    destinationType: selected.destinationType, destinationExtension: selected.destinationExtension,
    destinationServiceNumber: selected.destinationServiceNumber, target: targetNode,
  }));
  return {
    source: overview?.demo ? "demo" : "portal-live",
    didId: selected.id || selected.name || "did",
    liveVerifiedAt: targetNode.config?.branchSource === "verified-live" ? overview?.syncedAt : "",
    writeContext: overview?.settings?.writeContext,
    providerRevision,
    original: {
      did: selected.name || selected.id || portalMessage("portal.number_b7905", "Number"),
      destinationName: selected.destinationName || selected.value || "",
      destinationExtension: selected.destinationExtension || "",
      destinationType: selected.destinationType || "",
    },
    nodes: [
      { id: "inbound", type: "DID", title: portalMessage("portal.incomingCall", "Incoming call"), subtitle: selected.name || selected.id || portalMessage("portal.number_b7905", "Number"), detail: portalMessage("portal.viaTrunkValue", "via trunk {p0}", { p0: trunk }), x: 46, y: 24, tone: "indigo", locked: true },
      targetNode,
    ],
    edges: [
      { from: "inbound", to: "target", label: portalMessage("portal.routesTo", "routes to") },
    ],
  };
}

function render() {
  renderHeader();
  renderStatus();
  renderMetrics();
  renderSummary();
  renderRoutingPreview();
  renderExtensionSummary();
  renderExtensions();
  renderExtensionDetail();
  renderExtensionActions();
  renderExtensionBatch();
  renderDidList();
  renderFlowResourcePalette();
  renderCallflow();
  renderFlowHelper();
  renderFlowFeedback();
  renderFlowProfileActions();
  renderDaynightGatewayPreview();
  renderFlowPlan();
  renderPhonebookSync();
  renderSettingsSummary();
  renderAuthLoginPanel();
  renderChangeAssistant();
  renderActionPlan();
  renderServices();
  renderEndpoints();
  renderDaynightModeModal();
  renderView();
}

function refreshPortalAccountLabel() {
  const target = $("#account-label");
  if (!target) return;
  const overview = getOverview();
  const account = visibleAccount(overview);
  const displayAccount = window.NFON_WEB_ONLY_DEMO && account === "Demo-Anlage"
    ? portalMessage("portal.demo.accountName", "Demo PBX")
    : account;
  target.textContent = overview
    ? portalMessage("portal.valueCheckedValue", "{p0} · checked {p1}", { p0: displayAccount || portalMessage("portal.loginRequired", "Login required"), p1: formatTime(overview.syncedAt) })
    : portalMessage("portal.viewTelephonyDataAndPrepareChanges", "View telephony data and prepare changes");
}

function renderHeader() {
  refreshPortalAccountLabel();
  const demoToggle = $("#demo-toggle");
  if (demoToggle) demoToggle.checked = state.demoMode;
  renderSettingsSummary();
  renderAuthLoginPanel();
}

function renderStatus() {
  const connection = $("#connection-state");
  if (!connection) return;
  const status = state.staticPaused && STATIC_DEMO_MODE
    ? { mode: "demo", tone: "neutral", label: portalMessage("demo.landing.paused", "Demo paused"), detail: "" }
    : portalConnectionStatus();
  connection.className = status.mode === "demo" ? "connection" : `connection is-${status.tone}`;
  connection.setAttribute("data-i18n-ignore", "");
  if (status.mode === "demo") connection.setAttribute("data-status-mode", "demo");
  else connection.removeAttribute("data-status-mode");
  connection.textContent = status.label;
  if (status.detail) connection.title = status.detail;
  else connection.removeAttribute("title");
}

function renderMetrics() {
  const overview = getOverview();
  const issues = endpointIssues().length;
  const count = key => overview?.endpoints?.[key]?.ok === false ? "—" : overview?.counts?.[key] ?? "—";
  const statMetrics = [
    { label: portalMessage("portal.extensions", "Extensions"), value: count("extensions") },
    { label: portalMessage("portal.numbers", "Numbers"), value: count("dids") },
    { label: portalMessage("portal.devices", "Devices"), value: count("devices") },
    { label: portalMessage("portal.notes", "Notes"), value: issues },
  ];
  const resourceMetrics = [
    { label: portalMessage("portal.queues", "Queues"), value: count("queues"), resource: "queues" },
    { label: portalMessage("portal.skillGroups", "Skill groups"), value: count("skills"), resource: "skills" },
    { label: portalMessage("portal.voiceDialogs", "Voice dialogs"), value: count("ivrs"), resource: "ivrs" },
    { label: portalMessage("portal.timeControls", "Time controls"), value: count("timeControls"), resource: "timeControls" },
  ].concat(
    overview?.endpoints?.frontdesks?.ok
      ? [{ label: "Frontdesk/Nia", value: count("frontdesks"), resource: "frontdesks" }]
      : []
  );
  const renderMetric = (metric) => `
    <${metric.resource ? "button" : "div"} class="metric ${metric.resource ? "is-resource" : ""}" ${metric.resource ? 'type="button"' : ""} data-metric="${escapeHtml(metric.label)}" ${metric.resource ? `data-resource-kind="${escapeHtml(metric.resource)}"` : ""}>
      <span class="metric-label">${escapeHtml(metric.label)}</span>
      <strong data-i18n-ignore>${escapeHtml(metric.value)}</strong>
    </${metric.resource ? "button" : "div"}>
  `;

  $("#metrics").innerHTML = `
    <div class="metric-group" aria-label="Statistiken">
      <span class="metric-group-title">${escapeHtml(portalMessage("portal.statistics", "Statistics"))}</span>
      <div class="metric-grid">${statMetrics.map(renderMetric).join("")}</div>
    </div>
    <div class="metric-group is-interactive" aria-label="Portal-Ressourcen">
      <span class="metric-group-title">${escapeHtml(portalMessage("portal.portalResources", "Portal resources"))}</span>
      <div class="metric-grid">${resourceMetrics.map(renderMetric).join("")}</div>
    </div>
  `;
}

let resourceReturnFocus = null;
let resourceCreateReturnFocus = null;

function openResourceModal(kind) {
  if (!RESOURCE_DEFS[kind]) return;
  resourceReturnFocus = document.activeElement;
  state.resourceModalKind = kind;
  renderResourceModal();
  $("#resource-modal button[data-close-resource-modal]")?.focus();
}

function closeResourceModal() {
  state.resourceModalKind = "";
  state.resourceDeleting = "";
  renderResourceModal();
  resourceReturnFocus?.focus?.();
  resourceReturnFocus = null;
}

function openResourceCreateModal(kind) {
  if (!RESOURCE_DEFS[kind]) return;
  resourceCreateReturnFocus = document.activeElement;
  state.resourceCreateKind = kind;
  state.resourceCreating = false;
  renderResourceCreateModal();
  $("#resource-create-modal input")?.focus();
}

function closeResourceCreateModal() {
  state.resourceCreateKind = "";
  state.resourceCreating = false;
  renderResourceCreateModal();
  resourceCreateReturnFocus?.focus?.();
  resourceCreateReturnFocus = null;
}

function renderResourceModal() {
  const modal = $("#resource-modal");
  if (!modal) return;
  const kind = state.resourceModalKind;
  const def = RESOURCE_DEFS[kind];
  modal.classList.toggle("is-open", Boolean(def));
  modal.setAttribute("aria-hidden", def ? "false" : "true");
  if (!def) return;

  const writesEnabled = liveApplyPermitted();
  const items = resourceItems(kind);
  $("#resource-modal-title").textContent = def.label;
  $("#resource-modal-subtitle").textContent = writesEnabled
    ? portalMessage("portal.valueEntriesFromThePortalApi", "{p0} entries from the Portal API", { p0: items.length, p1: items.length === 1 ? "" : "e" })
    : portalMessage("portal.valueEntriesFromThePortalApiLiveWritesDisabled", "{p0} entries from the Portal API · Live writes disabled", { p0: items.length, p1: items.length === 1 ? "" : "e" });
  const list = items.length ? items.map((item) => {
    const id = resourceNumber(item);
    const extension = resourceExtension(item);
    const links = resourceConnections(kind, item);
    const deleting = state.resourceDeleting === `${kind}:${id}`;
    return `
      <article class="resource-item">
        <div class="resource-item-main">
          <span class="resource-type">${escapeHtml(def.itemLabel)}</span>
          <strong data-i18n-ignore>${escapeHtml(item.name || id || def.itemLabel)}</strong>
          <span>${escapeHtml([
            id ? portalMessage("portal.serviceValue", "Service {number}", { number: id }) : "",
            extension && extension !== id ? portalMessage("portal.extensionValue", "Extension {p0}", { p0: extension }) : "",
          ].filter(Boolean).join(" · ") || portalMessage("portal.noNumberDetected", "No number detected"))}</span>
        </div>
        <div class="resource-links">
          <span>${escapeHtml(portalMessage("portal.connectedTo", "Connected to"))}</span>
          ${links.length ? links.map((link) => `
            <div class="resource-link">
              <strong data-i18n-ignore>${escapeHtml(link.label)}</strong>
              <small data-i18n-ignore>${escapeHtml(link.detail)}</small>
            </div>
          `).join("") : `<div class="empty-state is-compact">${escapeHtml(portalMessage("portal.noLinkDetected", "No link detected."))}</div>`}
        </div>
        <button class="secondary-button resource-delete" data-delete-resource-kind="${escapeHtml(kind)}" data-delete-resource-id="${escapeHtml(id)}" type="button" ${id && !deleting && writesEnabled ? "" : "disabled"}>
          ${!writesEnabled ? portalMessage("portal.locked", "Locked") : deleting ? portalMessage("portal.deleting", "Deleting...") : portalMessage("portal.delete", "Delete")}
        </button>
      </article>
    `;
  }).join("") : `<div class="empty-state">${escapeHtml(portalMessage("portal.noValueFound", "No {p0} found.", { p0: portalSystemText(def.label) }))}</div>`;
  $("#resource-modal-body").innerHTML = `
    <div class="resource-toolbar">
      <button class="primary-button" data-open-resource-create="${escapeHtml(kind)}" type="button" ${writesEnabled ? "" : "disabled"}>${escapeHtml(resourceActionText("create", kind))}</button>
      ${writesEnabled ? "" : `<span class="plan-note">${escapeHtml(liveWritesDisabledText())}</span>`}
    </div>
    ${list}
  `;
}

function portalSelectLabelAttributes(key, fallback, params = {}) {
  return `aria-label="${escapeHtml(portalMessage(key, fallback, params))}" data-i18n-aria-label="${escapeHtml(key)}" data-i18n-params="${escapeHtml(JSON.stringify(params))}"`;
}

function targetSelectLabelAttributes(field, label = null) {
  const labels = {
    openTarget: ["portal.targetInsideOpeningHours", "Target inside opening hours"],
    closedTarget: ["portal.targetOutsideOpeningHours", "Target outside opening hours"],
    timeoutTarget: ["portal.afterTimeout", "After timeout"],
    afterTarget: ["portal.thenForwardTo", "Then forward to"],
    keyTarget: ["portal.keyTarget", "Key target"],
  };
  const key = ivrKeyFromField(field);
  return portalSelectLabelAttributes(...(label || (key ? ["portal.keyValue", "Key {p0}", { p0: key }] : labels[field] || ["portal.selectExistingTarget", "Select existing target"])));
}

function targetSelectMarkup(name, required = false) {
  const options = targetOptions();
  return `
    <span class="select-search-stack">
      <input class="select-filter-input" type="search" ${portalPlaceholderAttributes("portal.searchTarget_fc750", "Search target...")} ${portalSelectLabelAttributes("portal.searchTarget", "Search target")}>
      <select name="${escapeHtml(name)}" ${required ? "required" : ""} ${targetSelectLabelAttributes(name, name === "timeoutTarget" ? ["portal.timeoutTarget", "Timeout target"] : null)}>
        <option value="">${escapeHtml(portalMessage("portal.selectTarget", "Select target"))}</option>
        <option value="${escapeHtml(JSON.stringify({ type: "HANGUP", title: portalMessage("portal.hangUp", "Hang up"), routeNumber: "HANGUP", number: "HANGUP" }))}">${escapeHtml(portalMessage("portal.hangUp", "Hang up"))}</option>
        ${options.map((target) => `<option value="${escapeHtml(target.value)}" data-i18n-ignore data-portal-target-option>${escapeHtml(target.label)}</option>`).join("")}
      </select>
    </span>
  `;
}

function announcementSelectMarkup() {
  const announcements = getOverview()?.inventory?.announcements || [];
  return `
    <span class="select-search-stack">
      <input class="select-filter-input" type="search" ${portalPlaceholderAttributes("portal.searchAnnouncement_f13ad", "Search announcement...")} ${portalSelectLabelAttributes("portal.searchAnnouncement", "Search announcement")}>
      <select name="announcementName" required ${portalSelectLabelAttributes("portal.announcement", "Announcement")}>
        <option value="">${escapeHtml(portalMessage("portal.selectAnnouncement", "Select announcement"))}</option>
        ${announcements.map((announcement) => {
          const value = announcement.name || announcement.value || announcement.id;
          return `<option value="${escapeHtml(value)}" data-i18n-ignore>${escapeHtml(value)}</option>`;
        }).join("")}
      </select>
    </span>
  `;
}

function renderResourceCreateModal() {
  const modal = $("#resource-create-modal");
  if (!modal) return;
  const kind = state.resourceCreateKind;
  const def = RESOURCE_DEFS[kind];
  modal.classList.toggle("is-open", Boolean(def));
  modal.setAttribute("aria-hidden", def ? "false" : "true");
  if (!def) return;

  $("#resource-create-title").textContent = resourceActionText("create", kind);
  const writesEnabled = liveApplyPermitted();
  $("#resource-create-subtitle").textContent = writesEnabled ? portalMessage("portal.createDirectlyInThePortalApi", "Create directly in the Portal API") : portalMessage("portal.liveCreationIsDisabledInThisEnvironment", "Live creation is disabled in this environment");
  $("#resource-create-body").innerHTML = `
    <form class="resource-create-form" id="resource-create-form" data-resource-create-kind="${escapeHtml(kind)}">
      <div class="field-grid">
        <label class="field-control">Name
          <input name="displayName" required maxlength="50" ${resourceNamePlaceholderAttributes(kind)}>
        </label>
        <label class="field-control">Service-Nummer
          <input name="serviceNumber" inputmode="numeric" ${kind === "queues" || kind === "skills" ? portalPlaceholderAttributes("portal.optionalField", "Optional") : portalPlaceholderAttributes("portal.server.automaticWhenEmpty", "Automatic when empty")}>
        </label>
        <label class="field-control">Nebenstelle
          <input name="extensionNumber" inputmode="numeric" ${kind === "queues" || kind === "skills" ? portalPlaceholderAttributes("portal.optionalField", "Optional") : portalPlaceholderAttributes("portal.server.automaticWhenEmpty", "Automatic when empty")}>
        </label>
      </div>
      ${kind === "ivrs" ? `
        <label class="field-control">Ansage
          ${announcementSelectMarkup()}
        </label>
        <div class="field-grid">
          <label class="field-control">Taste
            <input name="keyNumber" inputmode="numeric" value="1">
          </label>
          <label class="field-control">Ziel bei Taste
            ${targetSelectMarkup("keyTarget")}
          </label>
          <label class="field-control">Timeout-Ziel
            ${targetSelectMarkup("timeoutTarget")}
          </label>
        </div>
      ` : ""}
      ${kind === "timeControls" ? `
        <div class="field-grid">
          <label class="field-control">Von Tag
            <select name="fromDay">${WEEKDAY_OPTIONS.map(([value, label]) => `<option value="${value}" ${value === "MONDAY" ? "selected" : ""}>${escapeHtml(portalSystemText(label))}</option>`).join("")}</select>
          </label>
          <label class="field-control">Von Uhrzeit
            <input name="fromTime" type="time" value="08:00">
          </label>
          <label class="field-control">Bis Tag
            <select name="toDay">${WEEKDAY_OPTIONS.map(([value, label]) => `<option value="${value}" ${value === "FRIDAY" ? "selected" : ""}>${escapeHtml(portalSystemText(label))}</option>`).join("")}</select>
          </label>
          <label class="field-control">Bis Uhrzeit
            <input name="toTime" type="time" value="17:00">
          </label>
        </div>
        <div class="field-grid">
          <label class="field-control">Ziel innerhalb
            ${targetSelectMarkup("openTarget", true)}
          </label>
          <label class="field-control">Ziel außerhalb
            ${targetSelectMarkup("closedTarget", true)}
          </label>
        </div>
      ` : ""}
      <div class="resource-form-actions">
        <button class="secondary-button" data-close-resource-create type="button">${escapeHtml(portalMessage("portal.cancel", "Cancel"))}</button>
        <button class="primary-button" data-create-resource-submit type="submit" ${state.resourceCreating || !writesEnabled ? "disabled" : ""}>${!writesEnabled ? portalMessage("portal.locked", "Locked") : state.resourceCreating ? portalMessage("portal.creating", "Creating...") : portalMessage("portal.createLive", "Create live")}</button>
      </div>
    </form>
  `;
}

function parseTargetField(value) {
  if (!value) return null;
  try {
    const target = JSON.parse(value);
    return {
      type: target.type || "",
      title: target.title || "",
      routeNumber: target.routeNumber || target.serviceNumber || target.number || target.targetNumber || "",
      number: target.number || target.targetNumber || "",
      targetNumber: target.targetNumber || target.number || "",
      href: target.href || "",
    };
  } catch {
    return null;
  }
}

function resourceCreatePayload(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  return {
    displayName: data.displayName || "",
    serviceNumber: data.serviceNumber || "",
    extensionNumber: data.extensionNumber || "",
    announcementName: data.announcementName || "",
    keyNumber: data.keyNumber || "",
    keyTarget: parseTargetField(data.keyTarget),
    timeoutTarget: parseTargetField(data.timeoutTarget),
    fromDay: data.fromDay || "",
    fromTime: data.fromTime || "",
    toDay: data.toDay || "",
    toTime: data.toTime || "",
    openTarget: parseTargetField(data.openTarget),
    closedTarget: parseTargetField(data.closedTarget),
  };
}

async function createResource(form) {
  const kind = form.dataset.resourceCreateKind;
  if (!RESOURCE_DEFS[kind] || state.resourceCreating) return;
  if (!liveApplyPermitted()) {
    showUiNotice({ title: portalMessage("portal.liveWritesDisabled", "Live writes disabled"), message: liveWritesDisabledText(), type: "warning" });
    return;
  }
  const payload = resourceCreatePayload(form);
  const writeContext = state.overview?.settings?.writeContext;
  const current = () => isCurrentWriteContext(writeContext) && state.resourceCreateKind === kind;
  const progress = showUiProgress({ title: portalMessage("portal.creatingValue", "Creating {p0}", { p0: RESOURCE_DEFS[kind].itemLabel }), message: portalMessage("portal.thePortalApiIsCreatingTheResource", "The Portal API is creating the resource.") });
  state.resourceCreating = true;
  renderResourceCreateModal();
  try {
    if (!await enableActionWrites(writeContext, current) || !current()) { progress.close(); return; }
    await fetchJson(`/api/resources/${encodeURIComponent(kind)}`, {
      method: "POST", writeContext, body: JSON.stringify(payload),
    });
    if (!current()) { progress.close(); return; }
    await loadOverview();
    if (!current()) { progress.close(); return; }
    state.resourceModalKind = kind;
    state.resourceCreateKind = "";
    render();
    renderResourceModal();
    progress.success({ title: portalMessage("portal.valueCreated", "{p0} created", { p0: RESOURCE_DEFS[kind].itemLabel }), message: portalMessage("portal.theResourceWasCreatedLive", "The resource was created live.") });
  } catch (error) {
    if (!current()) { progress.close(); return; }
    progress.error({ title: portalMessage("portal.resourceNotCreated", "Resource not created"), message: error.message });
  } finally {
    state.resourceCreating = false;
    renderResourceCreateModal();
  }
}

function serviceCreateCardMarkup(kind) {
  const collection = serviceCollectionFromKind(kind);
  const label = kind === "skill" ? portalMessage("portal.skillGroup", "Skill group") : portalMessage("portal.queue", "Queue");
  const draft = serviceCreateDraftFor(kind);
  const creating = state.serviceCreating === kind;
  const disabled = creating || !localApplyPermitted();
  return `
    <form class="service-create-card" data-service-create-kind="${escapeHtml(kind)}">
      <div class="service-create-title">
        <span class="service-kind">${escapeHtml(label)}</span>
        <strong data-i18n-key="portal.resource.create.${collection}">${escapeHtml(resourceActionText("create", kind))}</strong>
      </div>
      <div class="service-create-fields">
        <label>Name
          <input name="displayName" data-service-create-field="displayName" value="${escapeHtml(draft.displayName || "")}" maxlength="50" ${resourceNamePlaceholderAttributes(kind)} required>
        </label>
        <label>Nebenstelle
          <input name="extensionNumber" data-service-create-field="extensionNumber" value="${escapeHtml(draft.extensionNumber || "")}" inputmode="numeric" ${portalPlaceholderAttributes("portal.optionalField", "Optional")}>
        </label>
      </div>
      <button class="primary-button" type="submit" ${disabled ? "disabled" : ""}>
        ${!localApplyPermitted() ? portalMessage("portal.liveWritesLocked", "Live writes locked") : creating ? portalMessage("portal.creating", "Creating...") : STATIC_DEMO_MODE ? portalMessage("portal.demo.createLocally", "Create locally") : resourceActionText("create", kind)}
      </button>
      ${STATIC_DEMO_MODE ? `<span class="plan-note">${escapeHtml(portalMessage("portal.demo.localWriteNotice", "Demo PBX: changes are saved locally."))}</span>` : !localApplyPermitted() ? `<span class="plan-note">${escapeHtml(liveWritesDisabledText())}</span>` : ""}
      <input type="hidden" name="resourceKind" value="${escapeHtml(collection)}">
    </form>
  `;
}

async function createServiceGroup(kind) {
  if (state.serviceCreating) return;
  const collection = serviceCollectionFromKind(kind);
  const label = kind === "skill" ? portalMessage("portal.skillGroup", "Skill group") : portalMessage("portal.queue", "Queue");
  const draft = serviceCreateDraftFor(kind);
  const displayName = String(draft.displayName || "").trim();
  if (!displayName) {
    state.serviceFeedback = { type: "error", title: portalMessage("portal.valueNotCreated", "{p0} not created", { p0: label }), message: portalMessage("portal.enterAName", "Enter a name.") };
    renderServices();
    return;
  }
  if (!localApplyPermitted()) {
    state.serviceFeedback = { type: "error", title: portalMessage("portal.liveWritesDisabled", "Live writes disabled"), message: liveWritesDisabledText() };
    renderServices();
    return;
  }
  const writeContext = state.overview?.settings?.writeContext;
  const payload = { displayName, serviceNumber: String(draft.serviceNumber || "").trim(), extensionNumber: String(draft.extensionNumber || "").trim() };
  const current = () => isCurrentWriteContext(writeContext);
  state.serviceCreating = kind;
  state.serviceFeedback = { type: "info", title: portalMessage("portal.creatingValue", "Creating {p0}", { p0: label }), message: (STATIC_DEMO_MODE ? portalMessage("portal.demo.creatingEntry", "The demo PBX is creating the entry locally.") : portalMessage("portal.thePortalApiIsCreatingTheNewEntry", "The Portal API is creating the new entry.")) };
  renderServices();
  try {
    if (!await enableActionWrites(writeContext, current) || !current()) return;
    await fetchJson(`/api/resources/${encodeURIComponent(collection)}`, {
      method: "POST", writeContext, body: JSON.stringify(payload),
    });
    if (!current()) return;
    resetServiceCreateDraft(kind);
    state.serviceGroups = null;
    state.serviceDraft = null;
    state.serviceDraftHistory = [];
    state.selectedServiceKey = "";
    state.serviceInspectorOpen = false;
    state.serviceFeedback = { type: "success", title: portalMessage("portal.valueCreated", "{p0} created", { p0: label }), message: portalMessage("portal.theInventoryWasReloaded", "The inventory was reloaded.") };
    await loadOverview();
    if (!current()) return;
    await loadServiceGroups({ quiet: true });
    state.serviceFeedback = { type: "success", title: portalMessage("portal.valueCreated", "{p0} created", { p0: label }), message: portalMessage("portal.theInventoryWasReloaded", "The inventory was reloaded.") };
  } catch (error) {
    if (!current()) return;
    state.serviceFeedback = { type: "error", title: portalMessage("portal.valueCouldNotBeCreated", "{p0} could not be created", { p0: label }), message: error.message };
    renderServices();
  } finally {
    state.serviceCreating = "";
    renderServices();
  }
}

async function deleteResource(kind, id) {
  const def = RESOURCE_DEFS[kind];
  const item = resourceItems(kind).find((entry) => resourceNumber(entry) === id);
  if (!def || !item || !id) return;
  if (!liveApplyPermitted()) {
    showUiNotice({ title: portalMessage("portal.liveWritesDisabled", "Live writes disabled"), message: liveWritesDisabledText(), type: "warning" });
    return;
  }
  const links = resourceConnections(kind, item);
  const warning = links.length
    ? `\n\n${portalMessage("portal.linkedResourceWarning", "Connections to this resource: {count}. Deletion may be refused.", { count: links.length })}`
    : "";
  const writeContext = state.overview?.settings?.writeContext;
  const confirmed = await confirmUi({
    title: resourceActionText("delete", kind),
    message: portalMessage("portal.deleteValueValueLiveValue", "Delete {p0} \"{p1}\" live?{p2}", { p0: def.itemLabel, p1: item.name || id, p2: warning }),
    confirmLabel: portalMessage("portal.delete", "Delete"),
    type: "warning",
  });
  if (!confirmed || !isCurrentWriteContext(writeContext) || !liveApplyPermitted()) return;

  const progress = showUiProgress({ title: portalMessage("portal.deletingValue", "Deleting {p0}", { p0: def.itemLabel }), message: portalMessage("portal.thePortalApiIsProcessingTheDeletion", "The Portal API is processing the deletion.") });
  state.resourceDeleting = `${kind}:${id}`;
  renderResourceModal();
  try {
    if (!await enableActionWrites(writeContext) || !isCurrentWriteContext(writeContext)) { progress.close(); return; }
    await fetchJson(`/api/resources/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, { method: "DELETE", writeContext });
    if (!isCurrentWriteContext(writeContext)) { progress.close(); return; }
    await loadOverview();
    if (!isCurrentWriteContext(writeContext)) { progress.close(); return; }
    state.resourceModalKind = kind;
    state.resourceDeleting = "";
    render();
    renderResourceModal();
    progress.success({ title: portalMessage("portal.valueDeleted", "{p0} deleted", { p0: def.itemLabel }), message: portalMessage("portal.theResourceWasDeletedLive", "The resource was deleted live.") });
  } catch (error) {
    if (!isCurrentWriteContext(writeContext)) { progress.close(); return; }
    state.resourceDeleting = "";
    renderResourceModal();
    progress.error({ title: portalMessage("portal.deletionFailed", "Deletion failed"), message: error.message });
  } finally {
    state.resourceDeleting = "";
    renderResourceModal();
  }
}

function renderSummary() {
  const overviewSummary = $("#overview-summary");
  if (overviewSummary) overviewSummary.innerHTML = "";
}

function renderRoutingPreview() {
  const dids = getOverview()?.inventory?.dids || [];
  const preview = dids.slice(0, 8);
  if (getOverview()?.endpoints?.dids?.ok === false) {
    $("#routing-preview").innerHTML = `<div class="empty-state">${escapeHtml(portalMessage("portal.inventoryUnavailable", "Data could not be loaded."))}</div>`; return;
  }
  if (!preview.length) {
    $("#routing-preview").innerHTML = `<div class="empty-state">${escapeHtml(portalMessage("portal.noNumberTargetsFound", "No number targets found."))}</div>`;
    return;
  }

  $("#routing-preview").innerHTML = preview.map((did) => `
    <div class="routing-item">
      <strong data-i18n-ignore>${escapeHtml(did.name)}</strong>
      <span>${escapeHtml(portalMessage("portal.routesTo", "routes to"))}</span>
      <b ${did.value ? 'data-i18n-ignore' : 'data-i18n-key="portal.noTargetDetected"'}>${escapeHtml(did.value || portalMessage("portal.noTargetDetected", "No target detected"))}</b>
    </div>
  `).join("");
}

function filteredExtensions() {
  const extensions = getOverview()?.inventory?.extensions || [];
  const filter = state.extensionFilter.trim().toLowerCase();
  return extensions.filter((extension) => {
    const haystack = `${extension.number} ${extension.name} ${extension.email} ${extension.device}`.toLowerCase();
    return !filter || haystack.includes(filter);
  });
}

function extensionRelations(extension) {
  if (!extension) return [];
  const number = String(extension.number || extension.id || "").trim();
  if (!number) return [];
  const overview = getOverview();
  const relations = [];
  for (const did of overview?.inventory?.dids || []) {
    const values = [did.destinationExtension, did.destinationServiceNumber, did.value, did.destinationName]
      .map((value) => String(value || ""));
    if (values.includes(number)) {
      relations.push({ label: portalMessage("portal.number_b7905", "Number"), detail: `${did.name || did.id || portalMessage("portal.number_b7905", "Number")} -> ${did.value || did.destinationName || number}` });
    }
  }
  for (const queue of overview?.inventory?.queues || []) {
    const members = queue.members || [];
    if (members.some((member) => String(member.extensionNumber || member.number || member.id || "") === number)) {
      relations.push({ label: portalMessage("portal.queue", "Queue"), detail: queue.name || queue.serviceNumber || queue.extensionNumber || portalMessage("portal.queue", "Queue") });
    }
  }
  for (const skill of overview?.inventory?.skills || []) {
    const members = skill.members || [];
    if (members.some((member) => String(member.extensionNumber || member.number || member.id || "") === number)) {
      relations.push({ label: portalMessage("portal.skillGroup", "Skill group"), detail: skill.name || skill.serviceNumber || skill.extensionNumber || portalMessage("portal.skillGroup", "Skill group") });
    }
  }
  return relations;
}

function renderExtensionSummary() {
  const target = $("#extension-summary");
  if (!target) return;
  const extensions = getOverview()?.inventory?.extensions || [];
  const withDevice = extensions.filter((extension) => extension.device).length;
  const selected = selectedExtension();
  target.innerHTML = `
    <div class="sync-stat-grid">
      <div class="sync-stat">
        <span>${escapeHtml(portalMessage("portal.inventory", "Inventory"))}</span>
        <strong>${escapeHtml(extensions.length)}</strong>
        <small>${escapeHtml(portalMessage("portal.extensionsFromThePortalApi", "Extensions from the Portal API"))}</small>
      </div>
      <div class="sync-stat">
        <span>${escapeHtml(portalMessage("portal.devices", "Devices"))}</span>
        <strong>${escapeHtml(withDevice)}</strong>
        <small>${escapeHtml(portalMessage("portal.assigned", "assigned"))}</small>
      </div>
      <div class="sync-stat">
        <span>${escapeHtml(portalMessage("portal.selection", "Selection"))}</span>
        <strong>${escapeHtml(selected?.number || "-")}</strong>
        <small ${(selected?.name) ? 'data-i18n-ignore' : 'data-i18n-key="portal.noExtension"'}>${escapeHtml(selected?.name || portalMessage("portal.noExtension", "No extension"))}</small>
      </div>
      <div class="sync-stat">
        <span>${escapeHtml(portalMessage("portal.linked", "Linked"))}</span>
        <strong>${escapeHtml(extensionRelations(selected).length)}</strong>
        <small>${escapeHtml(portalMessage("portal.detectedLinks", "detected links"))}</small>
      </div>
    </div>
  `;
}

function renderExtensions() {
  const visible = filteredExtensions();
  if (!visible.length) {
    $("#extension-list").innerHTML = `<div class="empty-state">${escapeHtml(portalMessage("portal.noExtensionFound_8e49e", "No extension found."))}</div>`;
    return;
  }

  $("#extension-list").innerHTML = `
    <div class="extension-table">
      <div class="extension-head" aria-hidden="true">
        <span>${escapeHtml(portalMessage("portal.nameField", "Name"))}</span>
        <span>${escapeHtml(portalMessage("portal.extension", "Extension"))}</span>
        <span>${escapeHtml(portalMessage("portal.type", "Type"))}</span>
        <span></span>
      </div>
      ${visible.map((extension) => `
        <button class="extension-row ${extension.id === state.selectedExtensionId ? "is-selected" : ""}" type="button" data-extension-id="${escapeHtml(extension.id)}">
          <span>
            <span class="extension-name" data-i18n-ignore>${escapeHtml(extension.name)}</span>
            <span class="extension-meta" ${(extension.device) ? 'data-i18n-ignore' : 'data-i18n-key="portal.unassigned"'}>${escapeHtml(extension.device || portalMessage("portal.unassigned", "Unassigned"))}</span>
          </span>
          <span class="extension-number" data-i18n-ignore>${escapeHtml(extension.number)}</span>
          <span class="extension-type">${escapeHtml(extension.type || "PHONE")}</span>
          <span class="extension-action">${escapeHtml(portalMessage("portal.select", "Select"))}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function renderExtensionDetail() {
  const extension = selectedExtension();
  if (!extension) {
    $("#extension-detail").innerHTML = `<div class="empty-state">${escapeHtml(portalMessage("portal.selectAnExtension", "Select an extension."))}</div>`;
    return;
  }

  const deviceStatus = extension.device ? portalMessage("portal.deviceAssigned", "Device assigned") : portalMessage("portal.noDeviceAssigned", "No device assigned");
  const relations = extensionRelations(extension);
  const usedFields = extensionUsedFieldEntries(extension);

  $("#extension-detail").innerHTML = `
    <div class="selected-title">
      <span class="extension-number" data-i18n-ignore>${escapeHtml(extension.number)}</span>
      <div>
        <strong data-i18n-ignore>${escapeHtml(extension.name)}</strong>
        <span>${escapeHtml(extension.type || portalMessage("portal.extension", "Extension"))}</span>
      </div>
    </div>

    <div class="field-grid">
      <div class="field"><span>${escapeHtml(portalMessage("portal.nameField", "Name"))}</span><strong data-i18n-ignore>${escapeHtml(extension.name)}</strong></div>
      <div class="field"><span>${escapeHtml(portalMessage("portal.device", "Device"))}</span><strong ${(extension.device) ? 'data-i18n-ignore' : 'data-i18n-key="portal.unassigned"'}>${escapeHtml(extension.device || portalMessage("portal.unassigned", "Unassigned"))}</strong></div>
      <div class="field"><span>Status</span><strong>${escapeHtml(deviceStatus)}</strong></div>
    </div>

    <div class="extension-field-section">
      <h3>${escapeHtml(portalMessage("portal.fieldInformation", "Field information"))}</h3>
      <div class="field-grid extension-used-fields">
        ${usedFields.length ? usedFields.map(([key, value]) => `
          <div class="field">
            <span>${escapeHtml(extensionFieldLabel(key))}</span>
            <strong ${typeof value === "boolean" ? `data-i18n-key="portal.${value ? "yes" : "no"}"` : "data-i18n-ignore"}>${escapeHtml(formatExtensionFieldValue(value))}</strong>
          </div>
        `).join("") : `<div class="empty-state is-compact">${escapeHtml(portalMessage("portal.noAdditionalFieldValuesWereDetectedInThePortal", "No additional field values were detected in the Portal inventory."))}</div>`}
      </div>
    </div>

    <div class="next-steps">
      <h3>${escapeHtml(portalMessage("portal.links", "Links"))}</h3>
      ${relations.length ? relations.map((relation) => `
        <div class="readiness-item is-ok">
          <strong>${escapeHtml(relation.label)}</strong>
          <span data-i18n-ignore>${escapeHtml(relation.detail)}</span>
        </div>
      `).join("") : `<div class="empty-state is-compact">${escapeHtml(portalMessage("portal.noDirectLinkToANumberQueueOrSkill", "No direct link to a number, queue or skill group detected."))}</div>`}
      <button class="wide-button" data-view-shortcut="callflow" type="button">${escapeHtml(portalMessage("portal.openCallflow", "Open callflow"))}</button>
    </div>
  `;
}

function extensionFieldLabel(key) {
  return portalSystemText(EXTENSION_FIELD_LABELS.get(key)) || String(key || "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function formatExtensionFieldValue(value) {
  if (value === true) return portalMessage("portal.yes", "Yes");
  if (value === false) return portalMessage("portal.no", "No");
  return String(value ?? "");
}

function extensionUsedFieldEntries(extension) {
  const fields = extension?.fields || {};
  const hiddenInfoFields = new Set(["href", "voicemailHref"]);
  const entries = Object.entries(fields).filter(([key, value]) => !hiddenInfoFields.has(key) && value !== undefined && value !== null && value !== "");
  const order = ["extensionNumber", "displayName", "targetType", "language", "costCenter", "accessCentralPhoneBook", "phoneBookHide", "device", "voicemailNumber"];
  return entries.sort(([left], [right]) => {
    const leftIndex = order.indexOf(left);
    const rightIndex = order.indexOf(right);
    if (leftIndex !== -1 || rightIndex !== -1) return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
    return extensionFieldLabel(left).localeCompare(extensionFieldLabel(right), portalLocale());
  });
}

function renderExtensionActions() {
  const target = $("#extension-actions");
  if (!target) return;
  target.innerHTML = extensionActionMarkup();
}

function extensionBatchRows() {
  return state.extensionBatchRows.map((row) => {
    const normalized = {
      extensionNumber: String(row.extensionNumber || "").trim(),
      displayName: String(row.displayName || "").trim(),
      mailboxPin: String(row.mailboxPin || "").trim(),
    };
    for (const field of selectedExtensionBatchFields()) {
      normalized[field.key] = normalizeExtensionBatchFieldValue(row[field.key], field);
    }
    return normalized;
  });
}

function selectedExtensionBatchFields() {
  return state.extensionBatchSelectedFields.map((key) => EXTENSION_BATCH_FIELD_MAP.get(key)).filter(Boolean);
}

function normalizeExtensionBatchFieldValue(value, field) {
  const current = value === undefined ? field.defaultValue : value;
  if (field.type === "boolean") return current === true || current === "true" || current === "1";
  if (field.type === "number") return current === "" || current === undefined || current === null ? field.defaultValue || 0 : Number(current);
  return String(current ?? "").trim();
}

function extensionBatchFieldValue(row, field) {
  return row[field.key] === undefined ? field.defaultValue : row[field.key];
}

function renderExtensionBatchInput(row, field) {
  const value = extensionBatchFieldValue(row, field);
  if (field.type === "boolean") {
    return `
      <label class="batch-inline-check">
        <input data-extension-batch-field="${escapeHtml(field.key)}" type="checkbox" ${normalizeExtensionBatchFieldValue(value, field) ? "checked" : ""}>
        <span>${escapeHtml(field.label)}</span>
      </label>
    `;
  }
  return `<input data-extension-batch-field="${escapeHtml(field.key)}" value="${escapeHtml(value || "")}" type="${field.type === "email" ? "email" : field.type === "number" ? "number" : "text"}" placeholder="${escapeHtml(field.placeholder || field.label)}">`;
}

function renderExtensionBatchFieldPicker() {
  if (!state.extensionBatchOptionalOpen) return "";
  const groups = [...new Set(EXTENSION_BATCH_OPTIONAL_FIELDS.map((field) => field.group))];
  return `
    <section class="batch-field-picker" aria-label="Optionale Spalten auswählen">
      <div class="batch-field-picker-head">
        <div>
          <strong>${escapeHtml(portalMessage("portal.customiseColumns", "Customise columns"))}</strong>
          <span>${escapeHtml(portalMessage("portal.onlySelectedFieldsAreDisplayedAndSentToThe", "Only selected fields are displayed and sent to the Portal API."))}</span>
        </div>
        <button class="secondary-button" id="close-extension-batch-fields" type="button">${escapeHtml(portalMessage("portal.close", "Close"))}</button>
      </div>
      <div class="batch-field-groups">
        ${groups.map((group) => `
          <fieldset>
            <legend>${escapeHtml(group)}</legend>
            ${EXTENSION_BATCH_OPTIONAL_FIELDS.filter((field) => field.group === group).map((field) => `
              <label class="batch-field-option">
                <input data-extension-batch-option="${escapeHtml(field.key)}" type="checkbox" ${state.extensionBatchSelectedFields.includes(field.key) ? "checked" : ""}>
                <span>${escapeHtml(field.label)}</span>
                <small>${field.groupKey === "voicemail" ? portalMessage("portal.voicemailEndpointField", "Voicemail endpoint") : portalMessage("portal.extension", "Extension")}</small>
              </label>
            `).join("")}
          </fieldset>
        `).join("")}
      </div>
    </section>
  `;
}

function renderExtensionBatch() {
  const target = $("#extension-batch");
  if (!target) return;
  const rows = state.extensionBatchRows;
  const plan = state.extensionBatchPlan;
  const writesEnabled = liveApplyPermitted();
  const optionalFields = selectedExtensionBatchFields();
  const tableColumns = `minmax(96px, .6fr) minmax(180px, 1fr) minmax(120px, .7fr) ${optionalFields.map(() => "minmax(150px, .85fr)").join(" ")} 42px`;
  const csvColumns = ["number", "name", "mailboxPin", ...optionalFields.map((field) => field.key)].join(",");
  target.innerHTML = `
    <div class="batch-help">
      <details>
        <summary>CSV Format</summary>
        <p>Erste Zeile als Kopf: <code>${escapeHtml(csvColumns)}</code>. Pflicht sind <code>number</code>, <code>name</code> und <code>mailboxPin</code>${escapeHtml(portalMessage("portal.optionalColumnsMatchTheEnabledApiFields", ". Optional columns match the enabled API fields."))}</p>
      </details>
      <label class="batch-upload">CSV Import
        <input id="extension-batch-csv" type="file" accept=".csv,text/csv">
      </label>
      <button class="secondary-button" id="toggle-extension-batch-fields" type="button" aria-expanded="${state.extensionBatchOptionalOpen ? "true" : "false"}">${escapeHtml(portalMessage("portal.customiseColumns", "Customise columns"))}</button>
    </div>
    ${renderExtensionBatchFieldPicker()}
    <div class="extension-batch-table" style="--batch-columns: ${escapeHtml(tableColumns)}">
      <div class="extension-batch-head">
        <span>${escapeHtml(portalMessage("portal.number", "Number"))}</span>
        <span>${escapeHtml(portalMessage("portal.nameField", "Name"))}</span>
        <span>Mailbox-PIN</span>
        ${optionalFields.map((field) => `<span>${escapeHtml(field.label)}</span>`).join("")}
        <span></span>
      </div>
      ${rows.map((row, index) => `
        <div class="extension-batch-row" data-extension-batch-row="${index}">
          <input data-extension-batch-field="extensionNumber" value="${escapeHtml(row.extensionNumber || "")}" inputmode="numeric" placeholder="201">
          <input data-extension-batch-field="displayName" value="${escapeHtml(row.displayName || "")}" ${portalPlaceholderAttributes("portal.nameField", "Name")}>
          <input data-extension-batch-field="mailboxPin" value="${escapeHtml(row.mailboxPin || "")}" inputmode="numeric" placeholder="123456">
          ${optionalFields.map((field) => renderExtensionBatchInput(row, field)).join("")}
          <button class="icon-button is-light" data-remove-extension-batch-row="${index}" type="button" aria-label="Zeile entfernen">×</button>
        </div>
      `).join("")}
    </div>
    ${plan ? `
      <div class="batch-result ${plan.ok ? "" : "is-warning"}">
        <div class="batch-result-header">
          <span class="batch-status-pill ${plan.ok ? "is-ok" : "is-warning"}">${plan.ok ? portalMessage("portal.ready", "Ready") : portalMessage("portal.check", "Check")}</span>
          <div>
            <strong data-i18n-ignore>${escapeHtml(plan.title || portalMessage("portal.batchChecked", "Batch checked"))}</strong>
            <span>${escapeHtml(plan.message || "")}</span>
          </div>
        </div>
        <div class="batch-summary-strip" aria-label="Batch Ergebnis">
          <div><span>${escapeHtml(portalMessage("portal.rows", "Rows"))}</span><strong>${escapeHtml(plan.summary?.total || 0)}</strong></div>
          <div><span>${escapeHtml(portalMessage("portal.ready", "Ready"))}</span><strong>${escapeHtml(plan.summary?.valid || 0)}</strong></div>
          <div><span>${escapeHtml(portalMessage("portal.needsCorrection", "Needs correction"))}</span><strong>${escapeHtml(plan.summary?.invalid || 0)}</strong></div>
          <div><span>${escapeHtml(portalMessage("portal.inventory", "Inventory"))}</span><strong>${escapeHtml(plan.summary?.existing || 0)}</strong></div>
        </div>
        <div class="batch-plan-list">
          ${(plan.entries || []).map((entry) => `
            <div class="batch-plan-row">
              <span class="batch-row-state ${entry.ok ? "is-ok" : "is-error"}">${entry.ok ? "OK" : portalMessage("portal.error", "Error")}</span>
              <strong>${escapeHtml(entry.extensionNumber || "-")}</strong>
              <span data-i18n-ignore>${escapeHtml(entry.displayName || "")}</span>
              <small>${entry.ok ? escapeHtml(portalMessage("portal.createAndSetMailboxPin", "Create and set mailbox PIN")) : portalMessagesMarkup(entry.errors || [], ", ")}</small>
            </div>
          `).join("")}
        </div>
        ${plan.ok && !plan.applied ? `
          <div class="sync-apply-row">
            <button class="primary-button" id="apply-extension-batch" type="button" ${writesEnabled ? "" : "disabled"}>${state.extensionBatchLoading ? portalMessage("portal.applying", "Applying...") : portalMessage("portal.applyBatch", "Apply batch")}</button>
            <span>${escapeHtml(writesEnabled ? portalMessage("portal.createsExtensionsLiveAndSetsTheMailboxPin", "Creates extensions live and sets the mailbox PIN.") : portalMessage("portal.liveWritesAreDisabledGloballyInSettings", "Live writes are disabled globally in Settings."))}</span>
          </div>
        ` : ""}
      </div>
    ` : ""}
  `;
}

function renderDidList() {
  const list = $("#did-list");
  if (!list) return;

  const dids = getOverview()?.inventory?.dids || [];
  if (!dids.length) {
    list.innerHTML = `<div class="empty-state">${escapeHtml(portalMessage("portal.noNumbersFound", "No numbers found."))}</div>`;
    return;
  }

  list.innerHTML = dids.map((did) => `
    <button class="did-row ${did.id === state.selectedDidId ? "is-selected" : ""}" type="button" data-did-id="${escapeHtml(did.id)}">
      <strong data-i18n-ignore>${escapeHtml(did.name)}</strong>
      <span ${(did.value || did.destinationName) ? 'data-i18n-ignore' : 'data-i18n-key="portal.noTargetDetected"'}>${escapeHtml(did.value || did.destinationName || portalMessage("portal.noTargetDetected", "No target detected"))}</span>
      <small>${escapeHtml(targetTypeLabel(did.destinationType))}</small>
    </button>
  `).join("");
}

function emptyFlowStepTarget() {
  return {
    type: "PLACEHOLDER",
    _i18nDefaults: flowNodeDefaultMetadata("PLACEHOLDER"),
    title: portalMessage("portal.newStep", "New step"),
    subtitle: portalMessage("portal.selectType", "Select type"),
    targetNumber: "",
    routeNumber: "",
    tone: targetTone("PLACEHOLDER"),
    config: {},
  };
}

function renderFlowResourcePalette({ preserveSearch = false } = {}) {
  const target = $("#flow-resource-palette");
  if (!target) return;
  const overview = getOverview();
  const groups = [
    {
      key: "extensions",
      title: portalMessage("portal.extensions", "Extensions"),
      type: "PHONEEXTENSION",
      tone: "green",
      items: (overview?.inventory?.extensions || []).filter((extension) => {
        const query = state.flowExtensionFilter.trim().toLowerCase();
        if (!query) return true;
        return `${extension.number || ""} ${extension.name || ""} ${extension.email || ""} ${extension.device || ""}`.toLowerCase().includes(query);
      }),
      fallback: portalMessage("portal.noExtensionFound", "No extension found"),
      searchable: true,
    },
    {
      key: "queues",
      title: portalMessage("portal.queues", "Queues"),
      type: "QUEUE",
      tone: "amber",
      items: overview?.inventory?.queues || [],
      fallback: portalMessage("portal.noQueues", "No queues"),
    },
    {
      key: "ivrs",
      title: portalMessage("portal.voiceDialogs", "Voice dialogs"),
      type: "IVR",
      tone: "coral",
      items: overview?.inventory?.ivrs || [],
      fallback: portalMessage("portal.noVoiceDialogs", "No voice dialogs"),
    },
    {
      key: "skills",
      title: portalMessage("portal.skillGroups", "Skill groups"),
      type: "SKILL",
      tone: "teal",
      items: overview?.inventory?.skills || [],
      fallback: portalMessage("portal.noSkillGroups", "No skill groups"),
    },
    {
      key: "timeControls",
      title: portalMessage("portal.timeControls", "Time controls"),
      type: "TIMECONTROL",
      tone: "purple",
      items: overview?.inventory?.timeControls || [],
      fallback: portalMessage("portal.noTimeControls", "No time controls"),
      limit: 12,
    },
    {
      key: "menus",
      title: portalMessage("portal.voiceDialogs", "Voice dialogs"),
      type: "IVR",
      tone: "purple",
      template: true,
      items: [{ id: "new-ivr-menu", name: portalMessage("portal.newVoiceDialog", "New voice dialog"), extensionNumber: "", serviceNumber: "" }],
    },
  ];

  const markup = groups.map((group) => `
    <section class="flow-menu-content" data-flow-menu-content="${escapeHtml(group.key)}">
      ${group.searchable ? `
        <input class="flow-palette-search" id="flow-extension-filter" type="search" ${portalPlaceholderAttributes("portal.searchNameOrNumber", "Search name or number")} value="${escapeHtml(state.flowExtensionFilter)}">
      ` : ""}
      <div class="flow-palette-list">
        ${group.items.length ? group.items.slice(0, group.limit || 8).map((item) => {
          const routeNumber = item.serviceNumber || item.id || item.value || "";
          const targetNumber = item.number || item.extensionNumber || item.value || "";
          const serviceMeta = group.key === "queues"
            ? serviceMetaFor("queue", item)
            : group.key === "skills"
              ? serviceMetaFor("skill", item)
              : {};
          const payload = item.payload
            ? clone(item.payload)
            : group.template
              ? {
              type: group.type,
              _i18nDefaults: flowNodeDefaultMetadata("IVR"),
              title: portalMessage("portal.voiceDialog", "Voice dialog"),
              subtitle: portalMessage("portal.configureKeys", "Configure keys"),
              targetNumber: "",
              routeNumber: "",
              tone: group.tone || targetTone(group.type),
              config: { portalMode: "new", announcement: "", ivrKeys: [] },
            }
            : group.type === "PHONEEXTENSION"
              ? {
                type: "PHONEEXTENSION",
                title: item.name || portalMessage("portal.extensionValue", "Extension {p0}", { p0: targetNumber }),
                subtitle: portalMessage("portal.extensionValue", "Extension {p0}", { p0: targetNumber }),
                targetNumber,
                routeNumber: targetNumber,
                tone: "green",
                extensionId: item.id || targetNumber,
              }
            : flowTargetFromApiTarget({
              type: group.type,
              title: item.name,
              subtitle: targetNumber ? `${targetTypeLabel(group.type)} ${targetNumber}` : targetTypeLabel(group.type),
              targetNumber,
              routeNumber,
              tone: group.tone || targetTone(group.type),
              config: { portalMode: "existing" },
              ...serviceMeta,
            });
          return `
            <button class="flow-palette-item is-${escapeHtml(payload.tone || targetTone(payload.type) || "muted")}" type="button" data-flow-palette-target="${escapeHtml(JSON.stringify(payload))}">
              <span ${group.template ? 'data-i18n-key="portal.newVoiceDialog"' : item.name ? "data-i18n-ignore" : ""}>${escapeHtml(item.name || group.title)}</span>
              <small ${item.detail ? "data-i18n-ignore" : ""}>${escapeHtml(item.detail || [targetNumber && portalMessage("portal.extensionValue", "Extension {p0}", { p0: targetNumber }), routeNumber && routeNumber !== targetNumber && portalMessage("portal.serviceValue", "Service {number}", { number: routeNumber })].filter(Boolean).join(" · ") || (group.template ? portalMessage("portal.createNew", "Create new") : targetTypeLabel(group.type)))}</small>
            </button>
          `;
        }).join("") : `<div class="empty-state is-compact">${escapeHtml(group.fallback || portalMessage("portal.noEntries", "No entries"))}</div>`}
      </div>
    </section>
  `).join("");
  const currentResults = preserveSearch && target.querySelector('[data-flow-menu-content="extensions"] .flow-palette-list');
  if (currentResults) {
    const next = document.createElement("div");
    next.innerHTML = markup;
    currentResults.innerHTML = next.querySelector('[data-flow-menu-content="extensions"] .flow-palette-list').innerHTML;
  } else {
    target.innerHTML = markup;
  }
}

function flowEdgeKey(edge) {
  return `${edge.from || ""}->${edge.to || ""}`;
}

function focusedFlowEdgeKeys(graph, selectedId) {
  if (!selectedId || !(graph?.edges || []).length) return null;
  const nodeIds = new Set((graph.nodes || []).map((node) => node.id));
  if (!nodeIds.has(selectedId)) return null;

  const incoming = new Map();
  for (const edge of graph.edges || []) {
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    incoming.get(edge.to).push(edge);
  }

  const focused = new Set();
  const visited = new Set([selectedId]);
  const stack = [selectedId];
  while (stack.length) {
    const nodeId = stack.pop();
    for (const edge of incoming.get(nodeId) || []) {
      focused.add(flowEdgeKey(edge));
      if (!visited.has(edge.from)) {
        visited.add(edge.from);
        stack.push(edge.from);
      }
    }
  }
  return focused;
}

function normalizedSelectionRect() {
  if (!selectionRectState) return null;
  const left = Math.min(selectionRectState.start.x, selectionRectState.current.x);
  const top = Math.min(selectionRectState.start.y, selectionRectState.current.y);
  const width = Math.abs(selectionRectState.current.x - selectionRectState.start.x);
  const height = Math.abs(selectionRectState.current.y - selectionRectState.start.y);
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function nodeIntersectsRect(node, rect) {
  const box = nodeWorldBox(node);
  return box.x < rect.right
    && box.x + FLOW_NODE_WIDTH > rect.left
    && box.y < rect.bottom
    && box.y + FLOW_NODE_HEIGHT > rect.top;
}

function selectedNodeIdSet() {
  return new Set(Array.isArray(state.selectedNodeIds) ? state.selectedNodeIds : []);
}

function renderCallflow() {
  const undoButton = $("#undo-flow-change");
  if (undoButton) undoButton.disabled = !flowUndoHistory.some(entry => entry.key === flowDraftKey());
  const availability = flowAvailability();
  if (availability) {
    const canvas = $("#callflow-canvas");
    if (canvas) canvas.innerHTML = `<div class="empty-state" role="status">${escapeHtml(availability.message)}</div>`;
    return;
  }
  $("#callflow-canvas")?.closest(".flow-canvas-shell")?.classList.toggle("is-zoomed-out", (state.flowZoom || 1) < 0.75);
  const flow = state.flow || buildDemoFlow(getOverview() || {});
  sanitizeFlowPositions(flow);
  const graph = buildVisibleFlowGraph(flow);
  const nodes = graph.nodes;
  const nodeById = Object.fromEntries(nodes.map((node) => [node.id, node]));
  const focusedEdges = focusedFlowEdgeKeys(graph, state.selectedNodeId);
  const zoom = state.flowZoom || 1;
  const boxes = nodes.map(nodeWorldBox);
  // The extra margin includes Bezier control points, not just the card rectangles.
  const worldWidth = Math.max(FLOW_WORLD_WIDTH, ...boxes.map(box => Math.ceil(box.x + box.width + 300)));
  const worldHeight = Math.max(FLOW_WORLD_HEIGHT, ...boxes.map(box => Math.ceil(box.y + box.height + 300)));
  const edgeViews = graph.edges.map((edge) => {
    const from = nodeById[edge.from];
    const to = nodeById[edge.to];
    if (!from || !to) return { path: "", insert: "" };
    const fromBox = nodeWorldBox(from);
    const toBox = nodeWorldBox(to);
    const { fromPoint, c1, c2, toPoint } = flowConnectionCurve(fromBox, toBox, edge.virtual && edge.memberSidePorts);
    const pathD = `M ${fromPoint.x} ${fromPoint.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${toPoint.x} ${toPoint.y}`;
    const actionT = 0.62;
    const arrow = cubicPointOnPath(fromPoint, c1, c2, toPoint, actionT);
    const tangentX = cubicTangent(fromPoint.x, c1.x, c2.x, toPoint.x, actionT);
    const tangentY = cubicTangent(fromPoint.y, c1.y, c2.y, toPoint.y, actionT);
    const arrowAngle = Math.atan2(tangentY, tangentX) * (180 / Math.PI);
    const distance = Math.hypot(toPoint.x - fromPoint.x, toPoint.y - fromPoint.y);
    const isBranchAction = Boolean(edge.branchField && edge.label);
    const isVirtualEdge = Boolean(edge.virtual);
    const focusClass = !focusedEdges || focusedEdges.has(flowEdgeKey(edge)) ? "is-focused" : "is-muted";
    return {
      path: `
      <path class="flow-edge ${focusClass}" d="${pathD}"></path>
      <path class="flow-edge-motion ${focusClass}" d="${pathD}" pathLength="100"></path>
    `,
      insert: !isVirtualEdge && distance > 40 ? `
      <button class="flow-insert ${isBranchAction ? "is-label" : "is-arrow"} ${focusClass}" type="button"
        data-insert-from="${escapeHtml(edge.from)}"
        data-insert-to="${escapeHtml(edge.to)}"
        style="left:${arrow.x}px;top:${arrow.y}px;--flow-angle:${arrowAngle}deg"
        data-i18n-title="portal.insertStepHere"
        title="${escapeHtml(portalMessage("portal.insertStepHere", "Insert step here"))}"
        ${portalSelectLabelAttributes("portal.insertStepBetweenValueAndValue", "Insert step between {p7} and {p8}", { p7: from.title, p8: to.title })}>
        <span class="flow-insert-default" aria-hidden="true">${isBranchAction ? escapeHtml(edge.label) : "→"}</span>
        <span class="flow-insert-plus" aria-hidden="true">+</span>
      </button>
    ` : "",
    };
  });
  const paths = edgeViews.map((view) => view.path).join("");
  const inserts = edgeViews.map((view) => view.insert).join("");
  const draftCable = renderDraftCable(nodeById);
  const selectedIds = selectedNodeIdSet();
  const selectionRect = normalizedSelectionRect();
  const selectionRectMarkup = selectionRect ? `
    <div class="flow-selection-rect"
      style="left:${selectionRect.left}px;top:${selectionRect.top}px;width:${selectionRect.width}px;height:${selectionRect.height}px"></div>
  ` : "";

  const canvas = $("#callflow-canvas");
  const previousScrollLeft = canvas?.scrollLeft || 0;
  const previousScrollTop = canvas?.scrollTop || 0;
  if (!canvas) return;
  canvas.innerHTML = `
    <div class="flow-world-wrap" style="width:${worldWidth * zoom}px;height:${worldHeight * zoom}px">
      <div class="flow-world" style="width:${worldWidth}px;height:${worldHeight}px;transform:scale(${zoom})">
        <svg class="flow-svg" viewBox="0 0 ${worldWidth} ${worldHeight}" aria-hidden="true">
          ${paths}
          ${draftCable}
        </svg>
        ${inserts}
        ${selectionRectMarkup}
        ${nodes.map((node) => {
          const box = nodeWorldBox(node);
          const serviceMeta = nodeServiceMeta(node);
          const serviceStyle = serviceMeta.serviceAccent
            ? `--node-accent:${serviceMeta.serviceAccent};--node-soft:${serviceMeta.serviceSoft || "#eef6ff"};`
            : "";
          const isBranchSelected = node.branchTarget
            && node.sourceId === state.selectedNodeId
            && node.branchField === state.selectedBranchField;
          const issues = nodeValidationIssues(node);
          const numberMeta = flowNodeNumberMeta(node);
          const tag = "div";
          const isMemberNode = Boolean(node.memberNode);
          const isInteractiveNode = !node.virtual || isMemberNode;
          const isSelected = node.id === state.selectedNodeId || selectedIds.has(node.id) || isBranchSelected;
          return `
            <${tag} class="flow-node is-${escapeHtml(node.tone || targetTone(node.type) || "muted")} ${serviceMeta.serviceAccent ? "has-service-color" : ""} ${isSelected ? "is-selected" : ""} ${node.branchTarget ? "is-branch-target" : ""} ${node.missing ? "is-missing" : ""} ${node.virtual ? "is-virtual-member" : ""} ${isMemberNode ? "is-service-member" : ""} ${issues.length ? "has-validation-error" : ""}"
              role="${isInteractiveNode ? "button" : "presentation"}"
              ${isInteractiveNode ? "tabindex=\"0\"" : ""}
              ${isInteractiveNode ? `data-node-id="${escapeHtml(node.id)}"` : ""}
              ${isMemberNode ? `data-service-node-id="${escapeHtml(node.serviceNodeId || "")}" data-member-key="${escapeHtml(node.memberKey || "")}"` : ""}
              style="left:${box.x}px;top:${box.y}px;${serviceStyle}">
              ${!node.virtual || isMemberNode ? `
                <div class="node-action-buttons" data-i18n-ignore aria-label="${escapeHtml(portalMessage("portal.valueActions", "{p0} actions", { p0: node.title }))}">
                  ${node.virtual ? "" : `<button class="node-action-button" type="button" data-node-edit="${escapeHtml(node.id)}" title="${escapeHtml(portalMessage("portal.edit", "Edit"))}" aria-label="${escapeHtml(portalMessage("portal.editValue", "Edit {p1}", { p1: node.title }))}">✎</button>`}
                  <button class="node-action-button is-danger" type="button" data-node-delete="${escapeHtml(node.id)}" title="${escapeHtml(portalMessage("portal.delete", "Delete"))}" aria-label="${escapeHtml(portalMessage("portal.deleteValue", "Delete {p0}", { p0: node.title }))}">×</button>
                </div>
              ` : ""}
              ${node.virtual ? "" : renderNodeDock(node)}
              <span class="node-type">${escapeHtml(readableNodeType(node.type))}</span>
              <span class="node-title" ${node.titleUserEdited || node.routeNumber || node.targetNumber || node.memberNode ? "data-i18n-ignore" : ""}>${escapeHtml(node.title)}</span>
              <span class="node-subtitle" data-i18n-ignore>${escapeHtml(flowNodeSubtitle(node))}</span>
              ${numberMeta ? `<span class="node-number-meta">${escapeHtml(numberMeta)}</span>` : ""}
              ${renderFlowNodeDetail(node)}
              ${issues.length ? `<span class="node-warning">${escapeHtml(issues[0])}</span>` : ""}
            </${tag}>
          `;
        }).join("")}
      </div>
    </div>
  `;
  canvas.scrollLeft = previousScrollLeft;
  canvas.scrollTop = previousScrollTop;
  const wrappedToolbar = ($(".flow-menu-launcher")?.clientWidth || 0) > canvas.clientWidth * 0.75;
  if (canvas.clientWidth > 0 && (canvas.clientWidth < 600 || wrappedToolbar) && canvas.dataset.initialDid !== state.selectedDidId && nodes.length) {
    canvas.dataset.initialDid = state.selectedDidId;
    const boxes = nodes.map(nodeWorldBox);
    canvas.scrollLeft = Math.max(0, Math.min(...boxes.map(box => box.x)) * zoom - 24);
    canvas.scrollTop = Math.max(0, Math.min(...boxes.map(box => box.y)) * zoom - 140);
  }
  const zoomLabel = $("#zoom-label");
  if (zoomLabel) zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

function openNodeConnectionSelector(nodeId) {
  const node = (state.flow?.nodes || []).find(item => item.id === nodeId) || visibleFlowNodeById(nodeId);
  if (!node) return;
  state.selectedNodeId = node.id;
  state.selectedNodeIds = [];
  state.selectedBranchField = "";
  state.inspectorOpen = true;
  renderCallflow();
  renderFlowHelper();
  renderView();
  ($("#flow-connect-target") || $("#close-flow-helper"))?.focus();
}

function renderNodeDock(node) {
  return `
    <button class="node-dock" type="button"
      data-node-dock="${escapeHtml(node.id)}"
      data-i18n-ignore
      title="${escapeHtml(portalMessage("portal.dragConnection", "Drag connection"))}"
      aria-label="${escapeHtml(portalMessage("portal.dragConnectionFromValue", "Drag connection from {p1}", { p1: node.title }))}">
      <span class="node-dock-icon" aria-hidden="true"></span>
    </button>
  `;
}

function dockPointForBox(box, pointer) {
  const left = box.x;
  const right = box.x + box.width;
  const top = box.y;
  const bottom = box.y + box.height;
  const x = clamp(pointer?.x ?? box.centerX, left, right);
  const y = clamp(pointer?.y ?? box.centerY, top, bottom);
  const candidates = [
    { x, y: top, rotation: -90, distance: Math.abs((pointer?.y ?? box.centerY) - top) },
    { x: right, y, rotation: 0, distance: Math.abs((pointer?.x ?? box.centerX) - right) },
    { x, y: bottom, rotation: 90, distance: Math.abs((pointer?.y ?? box.centerY) - bottom) },
    { x: left, y, rotation: 180, distance: Math.abs((pointer?.x ?? box.centerX) - left) },
  ];
  return candidates.sort((a, b) => a.distance - b.distance)[0];
}

function dockPointForNode(node, pointer) {
  return dockPointForBox(nodeWorldBox(node), pointer);
}

function nodeElementWorldBox(node, nodeElement) {
  const box = nodeWorldBox(node);
  if (!nodeElement) return box;
  return {
    ...box,
    width: nodeElement.offsetWidth || box.width,
    height: nodeElement.offsetHeight || box.height,
    centerX: box.x + (nodeElement.offsetWidth || box.width) / 2,
    centerY: box.y + (nodeElement.offsetHeight || box.height) / 2,
  };
}

function renderDraftCable(nodeById) {
  const draft = state.cableDrag;
  if (!draft?.fromId || !draft.current) return "";
  const from = nodeById[draft.fromId] || (state.flow?.nodes || []).find((node) => node.id === draft.fromId);
  if (!from) return "";
  const start = draft.start || dockPointForNode(from, draft.current);
  const end = draft.current;
  const c1 = { x: start.x + (end.x - start.x) * 0.42, y: start.y };
  const c2 = { x: start.x + (end.x - start.x) * 0.62, y: end.y };
  return `<path class="flow-edge flow-edge-draft" d="M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}" pathLength="100"></path>`;
}

function buildVisibleFlowGraph(flow) {
  normalizeCallflowStructure(flow);
  pruneDisconnectedFlowNodes(flow);
  materializeBranchNodes(flow);
  const nodes = [...(flow.nodes || [])];
  const edges = [...(flow.edges || [])];
  appendServiceMemberGraph(nodes, edges);
  return {
    nodes,
    edges,
  };
}

function serviceMemberKey(member, index = 0) {
  return String(member?.number || member?.extensionNumber || member?.id || index);
}

function serviceMemberNodeId(serviceNodeId, memberKey) {
  return `${serviceNodeId}-member-${memberKey}`;
}

function serviceMemberLayouts(serviceNode) {
  ensureNodeConfig(serviceNode);
  serviceNode.config.memberLayouts ||= {};
  return serviceNode.config.memberLayouts;
}

function serviceMemberDefaultPositions(serviceNode, members, nodes) {
  const parent = nodeWorldBox(serviceNode);
  const saved = serviceNode.config?.memberLayouts || {};
  const gapY = 32, branchGap = 80;
  // Use one row height for the entire block, including wrapped names.
  const cardHeight = Math.max(128, ...members.map((member, index) => {
    const box = nodeWorldBox({ id: serviceMemberNodeId(serviceNode.id, serviceMemberKey(member, index)), x: 0, y: 0 });
    return Math.max(box.height, 128 + Math.max(0, Math.ceil(String(member.name || "").length / 23) - 1) * 24);
  }));
  const occupied = nodes.map(node => {
    const box = nodeWorldBox(node);
    return { ...box, height: Math.max(box.height, node.memberNode ? 128 : 240) };
  });
  members.forEach((member, index) => {
    const position = saved[serviceMemberKey(member, index)];
    if (position) occupied.push({ x: position.x / 100 * FLOW_WORLD_WIDTH, y: position.y / 100 * FLOW_POSITION_HEIGHT, width: FLOW_NODE_WIDTH, height: cardHeight });
  });
  const makeSlots = (columns, offset) => {
    const slots = members.map((member, index) => {
      const column = index % columns, count = Math.ceil((members.length - column) / columns);
      const top = parent.centerY - (count * cardHeight + Math.max(0, count - 1) * gapY) / 2;
      return { memberKey: serviceMemberKey(member, index), side: columns === 2 && column === 0 ? -1 : 1,
        x: parent.centerX + (columns === 2 && column === 0 ? -offset : offset) - FLOW_NODE_WIDTH / 2,
        y: top + Math.floor(index / columns) * (cardHeight + gapY) };
    });
    const shiftY = Math.max(0, FLOW_SAFE_TOP - Math.min(...slots.map(slot => slot.y)));
    return slots.map(slot => ({ ...slot, y: slot.y + shiftY }));
  };
  const collisionsFor = slots => occupied.flatMap(box => slots.filter(slot => !saved[slot.memberKey]
    && slot.x < box.x + box.width + gapY && slot.x + FLOW_NODE_WIDTH + gapY > box.x
    && slot.y < box.y + box.height + gapY && slot.y + cardHeight + gapY > box.y).map(slot => ({ box, slot })));
  let columns = members.length > 4 ? 2 : 1;
  let offset = parent.width / 2 + branchGap + FLOW_NODE_WIDTH / 2;
  let slots;
  // Opposite banks keep every branch visible; a second bank behind the first hides its links.
  // Move both banks symmetrically around obstacles, falling back to one ordered column at the left edge.
  for (let pass = 0; pass <= occupied.length * 2 + 2; pass++) {
    if (columns === 2 && parent.centerX - offset - FLOW_NODE_WIDTH / 2 < FLOW_CANVAS_EDGE_PADDING) {
      columns = 1;
      offset = parent.width / 2 + branchGap + FLOW_NODE_WIDTH / 2;
    }
    slots = makeSlots(columns, offset);
    const collisions = collisionsFor(slots);
    if (!collisions.length) break;
    offset = Math.max(offset, ...collisions.map(({ box, slot }) => slot.side === -1
      ? parent.centerX - box.x + gapY + FLOW_NODE_WIDTH / 2
      : box.x + box.width + gapY - parent.centerX + FLOW_NODE_WIDTH / 2));
  }
  return slots.map(slot => ({ x: slot.x / FLOW_WORLD_WIDTH * 100, y: slot.y / FLOW_POSITION_HEIGHT * 100 }));
}

function setServiceMemberLayout(serviceNodeId, memberKey, position) {
  const serviceNode = (state.flow?.nodes || []).find((node) => node.id === serviceNodeId);
  if (!serviceNode || !memberKey || !position) return null;
  const safe = safeFlowPosition(Number(position.x) || 0, Number(position.y) || 0);
  serviceMemberLayouts(serviceNode)[String(memberKey)] = safe;
  return safe;
}

function visibleFlowNodeById(id) {
  if (!id || !state.flow) return null;
  return buildVisibleFlowGraph(state.flow).nodes.find((node) => node.id === id) || null;
}

function appendServiceMemberGraph(nodes, edges) {
  const sourceNodes = [...nodes];
  sourceNodes.forEach((node) => {
    const kind = normalizeTargetType(node.type);
    if (!["QUEUE", "GROUP", "SKILL"].includes(kind)) return;
    if (!state.expandedServiceNodeIds.includes(node.id)) return;
    const meta = nodeServiceMeta(node);
    const members = Array.isArray(meta.memberTargets) && meta.memberTargets.length ? meta.memberTargets
      : (meta.memberNames || []).map(name => ({ name, number: "" }));
    const positions = serviceMemberDefaultPositions(node, members, nodes);
    const parentBox = nodeWorldBox(node);
    const targetBoxes = members.map((member, index) => nodeWorldBox({
      id: serviceMemberNodeId(node.id, serviceMemberKey(member, index)),
      ...(node.config?.memberLayouts?.[serviceMemberKey(member, index)] || positions[index]),
    }));
    // Keep radial fan-out for opposite banks; only a single bank needs side ports to clear its other cards.
    const memberSidePorts = !(targetBoxes.some(box => box.x + box.width <= parentBox.x)
      && targetBoxes.some(box => box.x >= parentBox.x + parentBox.width));
    members.forEach((member, index) => {
      const memberKey = serviceMemberKey(member, index);
      const id = serviceMemberNodeId(node.id, memberKey);
      if (nodes.some((item) => item.id === id)) return;
      const savedPosition = serviceMemberLayouts(node)[memberKey];
      const position = savedPosition || positions[index];
      nodes.push({
        id,
        type: "PHONEEXTENSION",
        title: member.name || portalMessage("portal.extension", "Extension"),
        subtitle: member.number ? portalMessage("portal.extensionValue", "Extension {p0}", { p0: member.number }) : portalMessage("portal.extension", "Extension"),
        targetNumber: member.number || "",
        routeNumber: member.number || "",
        x: position.x,
        y: position.y,
        tone: "green",
        virtual: true,
        memberNode: true,
        serviceNodeId: node.id,
        memberKey,
      });
      edges.push({
        from: node.id,
        to: id,
        label: portalMessage("portal.member", "member"),
        virtual: true,
        memberSidePorts,
      });
    });
  });
}

function materializeBranchNodes(flow) {
  if (flowRoutingConflicts(flow).length) return flow;
  flow.nodes ||= [];
  flow.edges ||= [];
  for (let pass = 0; pass < 8; pass += 1) {
    const before = `${flow.nodes.length}:${flow.edges.length}`;
    for (const node of [...flow.nodes]) {
      refreshFlowNodeDefaults(node);
      const kind = normalizeTargetType(node.type);
      if (node.isTarget) continue;
      ensureNodeConfig(node);
      if (kind === "TIMECONTROL") {
        if (node.config.portalMode === "existing" && !node.config.openTarget && !node.config.closedTarget) continue;
        ensureBranches(flow, node, [
          branchSpec("openTarget", portalMessage("portal.insideBranch", "inside"), portalMessage("portal.inside", "Inside"), portalMessage("portal.selectTarget", "Select target"), 24, -16, node.config.openTarget),
          branchSpec("closedTarget", portalMessage("portal.outside", "Outside"), portalMessage("portal.outside_a5443", "Outside"), portalMessage("portal.selectTarget", "Select target"), 24, 18, node.config.closedTarget),
        ]);
      }
      if (kind === "IVR") {
        if (node.config.portalMode === "existing" && !ivrKeyNumbers(node).length && !node.config.timeoutTarget) continue;
        const keys = ivrKeyNumbers(node);
        const keySpecs = keys.map((key, index) => {
          const field = ivrTargetField(key);
          return branchSpec(field, portalMessage("portal.keyValue", "Key {p0}", { p0: key }), portalMessage("portal.keyValue", "Key {p0}", { p0: key }), portalMessage("portal.selectTarget", "Select target"), 26, -22 + index * 24, node.config[field]);
        });
        ensureBranches(flow, node, [
          ...keySpecs,
          branchSpec("timeoutTarget", "Timeout", portalMessage("portal.noInput", "No input"), portalMessage("portal.selectTarget", "Select target"), 26, -22 + keys.length * 24, node.config.timeoutTarget),
        ]);
      }
      if (kind === "ANNOUNCEMENT") {
        ensureBranches(flow, node, [
          branchSpec("afterTarget", portalMessage("portal.afterBranch", "after"), portalMessage("portal.next", "Next"), portalMessage("portal.hangUpOrForward", "Hang up or forward"), 24, 8, node.config.afterTarget),
        ]);
      }
      if (kind === "QUEUE") {
        if (node.config.timeoutSeconds || node.config.timeoutTarget) {
          ensureBranches(flow, node, [
            branchSpec("timeoutTarget", portalMessage("portal.afterValues", "after {p0}s", { p0: node.config.timeoutSeconds || 120 }), "Timeout", portalMessage("portal.selectTarget", "Select target"), 24, 20, node.config.timeoutTarget),
          ]);
        } else {
          removeBranch(flow, node, "timeoutTarget");
        }
      }
    }
    const after = `${flow.nodes.length}:${flow.edges.length}`;
    if (after === before) break;
  }
}

function branchSpec(field, label, fallbackTitle, fallbackSubtitle, xOffset, yOffset, target = null) {
  return { field, label, fallbackTitle, fallbackSubtitle, xOffset, yOffset, target };
}

function ivrTargetField(key) {
  return `key${key}Target`;
}

function ivrKeyNumbers(node) {
  const configured = Array.isArray(node?.config?.ivrKeys)
    ? node.config.ivrKeys.map((key) => String(key)).filter(Boolean)
    : [];
  const existing = Object.keys(node?.config || {})
    .map((key) => key.match(/^key(\d)Target$/)?.[1])
    .filter(Boolean);
  const keys = [...new Set([...configured, ...existing])];
  if (!keys.length && node?.config?.ivrKeysVerified) return [];
  if (!keys.length) keys.push("1", "2");
  return keys.sort((left, right) => {
    const order = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
    return order.indexOf(left) - order.indexOf(right);
  });
}

function nextIvrKey(node) {
  const used = new Set(ivrKeyNumbers(node));
  return ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].find((key) => !used.has(key)) || "";
}

function ivrKeyFromField(field = "") {
  return String(field).match(/^key(\d)Target$/)?.[1] || "";
}

function collectSubtreeNodeIds(flow, rootId, ids = new Set()) {
  if (!flow || !rootId || ids.has(rootId)) return ids;
  ids.add(rootId);
  (flow.edges || [])
    .filter((edge) => edge.from === rootId)
    .forEach((edge) => collectSubtreeNodeIds(flow, edge.to, ids));
  return ids;
}

function removeNodeSet(flow, ids) {
  if (!flow || !ids?.size) return;
  flow.nodes = (flow.nodes || []).filter((node) => node.locked || !ids.has(node.id));
  flow.edges = (flow.edges || []).filter((edge) => !ids.has(edge.from) && !ids.has(edge.to));
}

function reachableFlowNodeIds(flow) {
  const nodes = flow?.nodes || [];
  const roots = nodes.filter((node) => node.locked);
  if (!roots.length && nodes[0]) roots.push(nodes[0]);
  const ids = new Set();
  roots.forEach((root) => collectSubtreeNodeIds(flow, root.id, ids));
  return ids;
}

function pruneDisconnectedFlowNodes(flow) {
  if (flowRoutingConflicts(flow).length) return flow;
  if (!flow?.nodes?.length) return;
  const reachable = reachableFlowNodeIds(flow);
  if (!reachable.size) return;
  const keep = new Set(reachable);
  (flow.nodes || [])
    .filter((node) => node.floating)
    .forEach((node) => collectSubtreeNodeIds(flow, node.id, keep));
  flow.nodes = flow.nodes.filter((node) => node.locked || keep.has(node.id));
  flow.edges = (flow.edges || []).filter((edge) => keep.has(edge.from) && keep.has(edge.to));
}

function clearBranchConfig(source, field) {
  if (!source || !field) return;
  ensureNodeConfig(source);
  const ivrKey = ivrKeyFromField(field);
  if (normalizeTargetType(source.type) === "IVR" && ivrKey) {
    source.config.ivrKeys = (source.config.ivrKeys || [])
      .map((item) => String(item))
      .filter((item) => item !== ivrKey);
    source.config.ivrKeysVerified = true;
  }
  delete source.config[field];
  syncBranchSourceConfig(source);
}

function finalizeFlowMutation() {
  if (state.flow) {
    pruneDisconnectedFlowNodes(state.flow);
    materializeBranchNodes(state.flow);
  }
  state.selectedNodeId = "";
  state.selectedNodeIds = [];
  state.selectedBranchField = "";
  state.inspectorOpen = false;
  saveCurrentFlowLayout();
  saveCurrentFlowDraft(false);
  state.flowFeedback = null;
  render();
}

function removeIvrKey(node, key) {
  if (!node || !key) return;
  const normalizedKey = String(key);
  const field = ivrTargetField(normalizedKey);
  clearBranchConfig(node, field);
  removeBranch(state.flow, node, field);
}

function ensureBranches(flow, source, specs) {
  ensureNodeConfig(source);
  const desiredFields = new Set(specs.map((spec) => spec.field));
  const outgoing = flow.edges.filter((edge) => edge.from === source.id);
  const nonBranchOutgoing = outgoing.filter((edge) => !edge.branchField);
  const reusableTargetIds = nonBranchOutgoing.map((edge) => edge.to);
  flow.edges = flow.edges.filter((edge) => edge.from !== source.id || edge.branchField);

  specs.forEach((spec, index) => {
    const existing = flow.edges.find((edge) => edge.from === source.id && edge.branchField === spec.field);
    if (existing) {
      existing.label = spec.label;
      const targetNode = flow.nodes.find((node) => node.id === existing.to);
      if (targetNode) {
        if (spec.target) applyTargetToNode(targetNode, spec.target);
        markBranchTarget(targetNode, source, spec);
        if (isMissingFlowNode(targetNode)) delete source.config[spec.field];
        else source.config[spec.field] = targetFromFlowNode(targetNode);
      }
      return;
    }
    const targetNode = nodeFromTargetSpec(flow, source, spec, reusableTargetIds[index]);
    if (isMissingFlowNode(targetNode)) delete source.config[spec.field];
    else source.config[spec.field] = targetFromFlowNode(targetNode);
    flow.edges.push({
      from: source.id,
      to: targetNode.id,
      label: spec.label,
      branchField: spec.field,
    });
  });

  flow.edges = flow.edges.filter((edge) => {
    if (edge.from !== source.id || !edge.branchField) return true;
    return desiredFields.has(edge.branchField);
  });
}

function removeBranch(flow, source, field) {
  if (!flow || !source || !field) return;
  const edge = (flow.edges || []).find((item) => item.from === source.id && item.branchField === field);
  if (!edge) return;
  flow.edges = flow.edges.filter((item) => item !== edge);
  const stillReferenced = (flow.edges || []).some((item) => item.to === edge.to);
  if (!stillReferenced) {
    removeNodeSet(flow, collectSubtreeNodeIds(flow, edge.to));
  }
}

function nodeFromTargetSpec(flow, source, spec, reusableId = "") {
  const reusable = flow.nodes.find((node) => node.id === reusableId && !node.locked && node.id !== source.id);
  if (reusable) {
    if (spec.target) applyTargetToNode(reusable, spec.target);
    markBranchTarget(reusable, source, spec);
    return reusable;
  }
  const baseId = `${source.id}-${spec.field}`;
  const id = flow.nodes.some((node) => node.id === baseId)
    ? `${baseId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`
    : baseId;
  const target = spec.target || {};
  const type = normalizeTargetType(target.type || "PLACEHOLDER");
  const node = {
    id,
    type,
    title: target.title || spec.fallbackTitle,
    titleUserEdited: Boolean(target.titleUserEdited),
    _i18nDefaults: target._i18nDefaults ? clone(target._i18nDefaults) : {},
    subtitle: target.subtitle || target.number || target.targetNumber || spec.fallbackSubtitle,
    targetNumber: target.targetNumber || target.number || "",
    routeNumber: target.routeNumber || "",
    ...safeFlowPosition((Number(source.x) || 20) + spec.xOffset, (Number(source.y) || 30) + spec.yOffset),
    tone: target.tone || targetTone(type),
    missing: !spec.target,
    config: target.config ? clone(target.config) : {},
  };
  refreshFlowNodeDefaults(node);
  markBranchTarget(node, source, spec);
  Object.assign(node, vacantFlowPosition(node.x, node.y, flow.nodes, node));
  flow.nodes.push(node);
  return node;
}

function markBranchTarget(node, source, spec) {
  node.branchTarget = true;
  node.sourceId = source.id;
  node.branchField = spec.field;
  node.isTarget = false;
  node.missing = node.missing || normalizeTargetType(node.type) === "PLACEHOLDER";
}

function branchTargetNode(source, field) {
  if (!source || !field) return null;
  const edge = (state.flow?.edges || []).find((item) => item.from === source.id && item.branchField === field);
  return (state.flow?.nodes || []).find((node) => node.id === edge?.to) || null;
}

function isMissingFlowNode(node) {
  if (!node) return true;
  return Boolean(node.missing) || normalizeTargetType(node.type) === "PLACEHOLDER" || !node.title || node.title === portalMessage("portal.selectTarget", "Select target");
}

function applyTargetToNode(node, target) {
  if (!node || !target) return;
  const type = normalizeTargetType(target.type);
  node.type = type;
  node._i18nDefaults = target._i18nDefaults ? clone(target._i18nDefaults) : {};
  node.titleUserEdited = Boolean(target.titleUserEdited);
  node.title = target.title || node.title || portalMessage("portal.destination", "Destination");
  node.subtitle = target.subtitle || target.number || target.targetNumber || node.subtitle || "";
  node.targetNumber = target.targetNumber || target.number || (target.config?.portalMode === "new" ? "" : targetNumberFromText(node.subtitle));
  node.routeNumber = target.routeNumber || target.serviceNumber || node.targetNumber || "";
  node.href = target.href || "";
  node.tone = target.tone || targetTone(type);
  node.config = target.config ? clone(target.config) : {};
  node.serviceKind = target.serviceKind || "";
  node.serviceColor = target.serviceColor || "";
  node.serviceAccent = target.serviceAccent || "";
  node.serviceSoft = target.serviceSoft || "";
  node.memberCount = Number.isFinite(Number(target.memberCount)) ? Number(target.memberCount) : "";
  node.memberNames = Array.isArray(target.memberNames) ? clone(target.memberNames) : [];
  node.memberTargets = Array.isArray(target.memberTargets) ? clone(target.memberTargets) : [];
  node.missing = false;
  refreshFlowNodeDefaults(node);
}

function syncBranchSourceConfig(node, visited = new Set()) {
  if (!node?.branchTarget || !node.sourceId || !node.branchField || visited.has(node.id)) return;
  visited.add(node.id);
  const source = (state.flow?.nodes || []).find((item) => item.id === node.sourceId);
  if (!source) return;
  ensureNodeConfig(source);
  if (isMissingFlowNode(node)) delete source.config[node.branchField];
  else source.config[node.branchField] = targetFromFlowNode(node);
  syncBranchSourceConfig(source, visited);
}

function targetFromFlowNode(node) {
  if (!node) return null;
  const target = {
    type: normalizeTargetType(node.type),
    title: node.title || portalMessage("portal.destination", "Destination"),
    titleUserEdited: Boolean(node.titleUserEdited),
    _i18nDefaults: node._i18nDefaults ? clone(node._i18nDefaults) : {},
    subtitle: node.subtitle || "",
    targetNumber: node.targetNumber || (node.config?.portalMode === "new" ? "" : targetNumberFromText(node.subtitle)),
    routeNumber: node.routeNumber || node.targetNumber || (node.config?.portalMode === "new" ? "" : targetNumberFromText(node.subtitle)),
    tone: node.tone || targetTone(node.type),
  };
  if (node.serviceKind) target.serviceKind = node.serviceKind;
  if (node.serviceColor) target.serviceColor = node.serviceColor;
  if (node.serviceAccent) target.serviceAccent = node.serviceAccent;
  if (node.serviceSoft) target.serviceSoft = node.serviceSoft;
  if (Number.isFinite(Number(node.memberCount))) target.memberCount = Number(node.memberCount);
  if (Array.isArray(node.memberNames) && node.memberNames.length) target.memberNames = clone(node.memberNames);
  if (Array.isArray(node.memberTargets) && node.memberTargets.length) target.memberTargets = clone(node.memberTargets);
  if (node.config && Object.keys(node.config).length) target.config = clone(node.config);
  return target;
}

function nodeWorldBox(node) {
  const position = boundedFlowPosition(node.x, node.y);
  const x = position.x / 100 * FLOW_WORLD_WIDTH;
  const y = position.y / 100 * FLOW_POSITION_HEIGHT;
  const element = [...document.querySelectorAll("#callflow-canvas .flow-node")].find(item => item.dataset.nodeId === node.id);
  const width = element?.offsetWidth || FLOW_NODE_WIDTH;
  const height = element?.offsetHeight || FLOW_NODE_HEIGHT;
  return {
    x,
    y,
    centerX: x + width / 2,
    centerY: y + height / 2,
    width,
    height,
  };
}

function flowConnectionCurve(fromBox, toBox, memberConnection = false) {
  // Fan-out stays in the space between a service and its target bank, including tall single columns.
  if (memberConnection && (toBox.x >= fromBox.x + fromBox.width || toBox.x + toBox.width <= fromBox.x)) {
    const right = toBox.x >= fromBox.x + fromBox.width;
    const fromPoint = { x: fromBox.x + (right ? fromBox.width : 0), y: fromBox.centerY };
    const toPoint = { x: toBox.x + (right ? 0 : toBox.width), y: toBox.centerY };
    const middleX = (fromPoint.x + toPoint.x) / 2;
    return { fromPoint, c1: { x: middleX, y: fromPoint.y }, c2: { x: middleX, y: toPoint.y }, toPoint };
  }
  const dx = toBox.centerX - fromBox.centerX;
  const dy = toBox.centerY - fromBox.centerY;
  const distanceBetweenCenters = Math.max(1, Math.hypot(dx, dy));
  const fromPoint = nodeEdgePoint(fromBox, toBox);
  const toPoint = nodeEdgePoint(toBox, fromBox);
  const controlDistance = clamp(distanceBetweenCenters * 0.35, 74, 230);
  const horizontalBias = smoothRatio(Math.abs(dx), Math.abs(dy));
  const verticalBias = 1 - horizontalBias;
  const sideCurve = (1 - Math.abs(horizontalBias - 0.5) * 2) * 52;
  const curveSign = dx * dy >= 0 ? 1 : -1;
  const c1 = {
    x: fromPoint.x + Math.sign(dx || 1) * controlDistance * horizontalBias + Math.sign(dy || 1) * sideCurve * curveSign,
    y: fromPoint.y + Math.sign(dy || 1) * controlDistance * verticalBias - Math.sign(dx || 1) * sideCurve * curveSign,
  };
  const c2 = {
    x: toPoint.x - Math.sign(dx || 1) * controlDistance * horizontalBias - Math.sign(dy || 1) * sideCurve * curveSign,
    y: toPoint.y - Math.sign(dy || 1) * controlDistance * verticalBias + Math.sign(dx || 1) * sideCurve * curveSign,
  };
  return { fromPoint, c1, c2, toPoint };
}

function nodeEdgePoint(sourceBox, targetBox) {
  const dx = targetBox.centerX - sourceBox.centerX;
  const dy = targetBox.centerY - sourceBox.centerY;
  if (!dx && !dy) return { x: sourceBox.centerX, y: sourceBox.centerY + sourceBox.height / 2 };

  const halfWidth = sourceBox.width / 2;
  const halfHeight = sourceBox.height / 2;
  const scale = Math.min(
    halfWidth / Math.max(Math.abs(dx), 1),
    halfHeight / Math.max(Math.abs(dy), 1),
  );

  return {
    x: sourceBox.centerX + dx * scale,
    y: sourceBox.centerY + dy * scale,
  };
}

function cubicPointOnPath(fromPoint, c1, c2, toPoint, t) {
  return {
    x: cubicPoint(fromPoint.x, c1.x, c2.x, toPoint.x, t),
    y: cubicPoint(fromPoint.y, c1.y, c2.y, toPoint.y, t),
  };
}

function flowNodeSubtitle(node) {
  const kind = normalizeTargetType(node.type);
  const generated = node._i18nDefaults?.subtitle;
  if (["QUEUE", "SKILL"].includes(kind) && generated?.key && node.subtitle === generated.value) {
    return portalMessage(generated.key, node.subtitle, generated.params || {});
  }
  if (kind === "PHONEEXTENSION" && node.targetNumber) {
    const templates = Object.values(window.NFON_MESSAGES?.["portal.extensionValue"] || {});
    const systemLabels = templates.filter(value => typeof value === "string").map(value => value.replace(/\{p0\}/g, node.targetNumber));
    if (systemLabels.includes(node.subtitle)) return portalMessage("portal.extensionValue", "Extension {p0}", { p0: node.targetNumber });
  }
  if (kind === "TIMECONTROL") return node.config?.hours || node.subtitle || portalMessage("portal.server.setTimeWindow", "Set time window");
  if (kind === "IVR") return node.config?.announcement ? portalMessage("portal.announcementValue", "Announcement: {p0}", { p0: node.config.announcement }) : node.subtitle || portalMessage("portal.configureKeys", "Configure keys");
  if (kind === "ANNOUNCEMENT") return node.config?.announcement || node.subtitle || portalMessage("portal.selectAnnouncement", "Select announcement");
  if (kind === "HANGUP") return portalMessage("portal.endCall", "End call");
  return node.subtitle || "";
}

function flowNodeNumberMeta(node) {
  const kind = normalizeTargetType(node?.type);
  if (!node || ["DID", "HANGUP", "PLACEHOLDER", "PHONEEXTENSION", "PHONE"].includes(kind)) return "";
  const extensionNumber = String(node.targetNumber || (node.config?.portalMode === "new" ? "" : targetNumberFromText(node.subtitle)) || "").trim();
  const routeNumber = String(node.routeNumber || "").trim();
  const parts = [];
  if (extensionNumber) parts.push(portalMessage("portal.extensionValue", "Extension {p0}", { p0: extensionNumber }));
  if (routeNumber && routeNumber !== extensionNumber && !["PHONEEXTENSION", "PHONE"].includes(kind)) {
    parts.push(portalMessage("portal.serviceValue", "Service {number}", { number: routeNumber }));
  }
  return parts.join(" · ");
}

function flowNodeDetail(node) {
  const kind = normalizeTargetType(node.type);
  if (kind === "DID") {
    if (node.id === "inbound" && node.locked) {
      const trunk = selectedDid()?.trunkNumber || getOverview()?.inventory?.trunks?.[0]?.name || "SIP Trunk";
      return portalMessage("portal.viaTrunkValue", "via trunk {p0}", { p0: trunk });
    }
    return node.detail || "";
  }
  if (kind === "TIMECONTROL") {
    return portalMessage("portal.insideOutside", "Inside / outside");
  }
  if (kind === "IVR") {
    return ivrKeyNumbers(node).map((key) => {
      const keyNode = branchTargetNode(node, ivrTargetField(key));
      return `${key} ${isMissingFlowNode(keyNode) ? portalMessage("portal.targetMissing", "Target missing") : keyNode.title}`;
    }).join(" / ");
  }
  if (kind === "ANNOUNCEMENT") {
    const afterNode = branchTargetNode(node, "afterTarget");
    return isMissingFlowNode(afterNode) ? portalMessage("portal.server.hangUpAfterwards", "Hang up afterwards") : afterNode.title;
  }
  if (["QUEUE", "GROUP", "SKILL"].includes(kind)) {
    const meta = nodeServiceMeta(node);
    const details = [];
    if (Number.isFinite(Number(meta.memberCount))) {
      const count = Number(meta.memberCount);
      details.push(portalMessage("portal.valueMembers", "{p0} members", { p0: count, p1: count === 1 ? "" : "er" }));
    }
    if (Array.isArray(meta.memberNames) && meta.memberNames.length) {
      details.push(portalMessage("portal.linkedValue", "Linked: {p0}", { p0: meta.memberNames.join(" / ") }));
    }
    if (kind === "QUEUE" && node.config?.timeoutSeconds) details.push(`Timeout ${node.config.timeoutSeconds}s`);
    return details.join(" · ");
  }
  return "";
}

function renderFlowNodeDetail(node) {
  const kind = normalizeTargetType(node?.type);
  if (["QUEUE", "GROUP", "SKILL"].includes(kind)) return renderServiceFlowNodeDetail(node);
  const detail = flowNodeDetail(node);
  return detail ? `<span class="node-detail" data-i18n-ignore>${escapeHtml(detail)}</span>` : "";
}

function renderServiceFlowNodeDetail(node) {
  const meta = nodeServiceMeta(node);
  const count = Number.isFinite(Number(meta.memberCount)) ? Number(meta.memberCount) : 0;
  const members = Array.isArray(meta.memberTargets) ? meta.memberTargets : [];
  const names = Array.isArray(meta.memberNames) ? meta.memberNames : [];
  const expanded = state.expandedServiceNodeIds.includes(node.id);
  const summary = count
    ? portalMessage("portal.valueMembers", "{p0} members", { p0: count, p1: count === 1 ? "" : "er" })
    : portalMessage("portal.noMembers", "No members");
  const preview = members.length
    ? members
    : names.map((name) => ({ name, number: "" }));
  return `
    <div class="node-detail service-node-detail">
      <span class="node-detail-summary">${escapeHtml(summary)}</span>
      ${preview.length ? `
        <button class="node-detail-toggle" type="button" data-node-members-toggle="${escapeHtml(node.id)}">
          ${expanded ? portalMessage("portal.hideTargets", "Hide targets") : portalMessage("portal.showTargets", "Show targets")}
        </button>
      ` : ""}
    </div>
  `;
}

function readableNodeType(type) {
  const labels = {
    DID: portalMessage("portal.number_b7905", "Number"),
    Trunk: portalMessage("portal.line", "Line"),
    PHONEEXTENSION: portalMessage("portal.extension", "Extension"),
    PHONE: portalMessage("portal.extension", "Extension"),
    QUEUE: portalMessage("portal.queue", "Queue"),
    GROUP: portalMessage("portal.skillGroup", "Skill group"),
    SKILL: portalMessage("portal.skillGroup", "Skill group"),
    FRONTDESK: "Frontdesk",
    TIMECONTROL: portalMessage("portal.timeControl", "Time control"),
    Zeitsteuerung: portalMessage("portal.time", "Time"),
    IVR: portalMessage("portal.voiceDialog", "Voice dialog"),
    ANNOUNCEMENT: portalMessage("portal.announcement", "Announcement"),
    HANGUP: portalMessage("portal.hangUp", "Hang up"),
    PLACEHOLDER: portalMessage("portal.path", "Path"),
    Gruppe: "Team",
    Nebenstelle: portalMessage("portal.extension", "Extension"),
    Fallback: "Fallback",
  };
  return labels[type] || type || portalMessage("portal.step", "Step");
}

function nodeTypeOptions(node) {
  const kind = normalizeTargetType(node?.type);
  if (kind === "PLACEHOLDER" || node?.missing) return ["PLACEHOLDER", "QUEUE", "IVR", "SKILL", "TIMECONTROL"];
  const options = ["PLACEHOLDER", "PHONEEXTENSION", "QUEUE", "SKILL", "FRONTDESK", "IVR", "TIMECONTROL", "ANNOUNCEMENT", "HANGUP"];
  return options.includes(kind) ? options : [kind, ...options];
}

function refreshFlowDraftPreview() {
  const preview = $("#flow-helper [data-flow-draft-preview]");
  if (preview) preview.textContent = `${selectedDid()?.name || "-"} → ${currentDraftTarget()}`;
  const validation = $("#flow-helper .validation-box span");
  if (validation) validation.innerHTML = portalMessagesMarkup(validateFlowDetails().checks);
}

function renderFlowHelper() {
  if (!state.inspectorOpen) {
    $("#flow-helper").innerHTML = "";
    return;
  }
  const bulkNodes = selectedNodes();
  if (bulkNodes.length > 1) {
    $("#flow-helper").innerHTML = renderBulkFlowHelper(bulkNodes);
    return;
  }
  const node = selectedNode();
  const did = selectedDid();
  if (!node) {
    $("#flow-helper").innerHTML = "";
    return;
  }
  ensureNodeConfig(node);
  const validation = validateFlowDetails();
  const kind = normalizeTargetType(node.type);
  if (state.selectedBranchField && kind === "TIMECONTROL") {
    $("#flow-helper").innerHTML = renderTimeControlBranchHelper(node, did, validation);
    return;
  }

  const targetEditMode = usesGenericTargetEditor(node);
  const targetNameIsDerived = usesDerivedTargetName(node);
  const numberMeta = flowNodeNumberMeta(node);
  $("#flow-helper").innerHTML = `
    <div class="helper-header">
      <h3>${targetEditMode ? portalMessage("portal.targetsToUpdate", "Targets to update") : portalMessage("portal.callflowStep", "Callflow step")}</h3>
      <button class="helper-close-button" id="close-flow-helper" type="button" aria-label="Eigenschaften schließen">×</button>
    </div>
    <p class="helper-copy">${targetEditMode ? portalMessage("portal.selectTheFutureTargetForThisNumberChangesRemain", "Select the future target for this number. Changes remain a draft.") : portalMessage("portal.configureThisStepRequiredFieldsAreCheckedBelow", "Configure this step. Required fields are checked below.")}</p>
    ${numberMeta ? `<div class="helper-number-meta">${escapeHtml(numberMeta)}</div>` : ""}
    <div class="before-after">
      <span>${escapeHtml(portalMessage("portal.current", "Current"))}</span>
      <strong data-i18n-ignore>${escapeHtml(did?.name || "-")} → ${escapeHtml(did?.value || portalMessage("portal.noTarget_1186c", "No target"))}</strong>
      <span>${escapeHtml(portalMessage("portal.draft", "Draft"))}</span>
      <strong data-flow-draft-preview data-i18n-ignore>${escapeHtml(did?.name || "-")} → ${escapeHtml(currentDraftTarget())}</strong>
    </div>
    <form class="action-form" id="node-form">
      <label>Art des Schritts
        <select data-node-field="type" ${node.locked ? "disabled" : ""}>
          ${node.locked ? `<option value="${escapeHtml(node.type)}" selected>${escapeHtml(readableNodeType(node.type))}</option>` : ""}
          ${nodeTypeOptions(node).map((type) => `
            <option value="${escapeHtml(type)}" ${kind === normalizeTargetType(type) ? "selected" : ""}>${escapeHtml(readableNodeType(type))}</option>
          `).join("")}
        </select>
      </label>
      <label>${kind === "IVR" ? portalMessage("portal.nameInPortal", "Name in Portal") : "Name"}
        <input data-node-field="title" value="${escapeHtml(node.title)}" ${node.locked || targetNameIsDerived ? "disabled" : ""}>
      </label>
      ${targetNameIsDerived ? `<p class="field-note">${escapeHtml(portalMessage("portal.theNameComesFromTheSelectedPortalTargetOnly", "The name comes from the selected Portal target. Only the route changes in this callflow."))}</p>` : ""}
      ${renderNodeConfiguration(node)}
    </form>
    ${renderConnectionBuilder(node)}
    <div class="helper-actions">
      <button class="secondary-button" id="delete-flow-node" type="button" ${node.locked ? "disabled" : ""}>${escapeHtml(portalMessage("portal.removeStep", "Remove step"))}</button>
    </div>
    <div class="validation-box">
      <strong>Status</strong>
      <span>${portalMessagesMarkup(validation.checks)}</span>
    </div>
  `;
}

function renderConnectionBuilder(node) {
  const targets = connectableFlowNodes(node);
  if (!targets.length) return "";
  return `
    <form class="action-form connection-form" id="connection-form">
      <label>Verbindung anlegen
        <select id="flow-connect-target">
          <option value="">${escapeHtml(portalMessage("portal.selectCallflowTarget", "Select callflow target"))}</option>
          ${targets.map((target) => `
            <option value="${escapeHtml(target.id)}" data-i18n-ignore data-portal-connection-option>${escapeHtml(connectionTargetLabel(target))}</option>
          `).join("")}
        </select>
      </label>
    </form>
  `;
}

function connectableFlowNodes(node) {
  if (!state.flow || !node) return [];
  const graph = buildVisibleFlowGraph(state.flow);
  return graph.nodes
    .filter((candidate) => candidate.id !== node.id && !candidate.virtual && !(candidate.locked && node.locked))
    .sort((a, b) => flowDirectionRank(a) - flowDirectionRank(b) || Number(a.x || 0) - Number(b.x || 0));
}

function connectionTargetLabel(node) {
  const kind = normalizeTargetType(node.type);
  const number = node.targetNumber || node.routeNumber;
  const description = ["PHONEEXTENSION", "PHONE"].includes(kind) && number
    ? portalMessage("portal.extensionValue", "Extension {p0}", { p0: number })
    : kind === "HANGUP" ? portalMessage("portal.endCall", "End call") : flowNodeNumberMeta(node) || node.subtitle;
  return [readableNodeType(node.type), node.title, description].filter(Boolean).join(" · ");
}

function renderBulkFlowHelper(nodes) {
  const editableNodes = nodes.filter((node) => !node.locked);
  const labels = editableNodes.slice(0, 5).map((node) => node.title).join(" · ");
  return `
    <div class="helper-header">
      <h3>${escapeHtml(portalMessage("portal.valueNodesSelected", "Nodes selected: {p0}", { p0: nodes.length }))}</h3>
      <button class="helper-close-button" id="close-flow-helper" type="button" aria-label="Auswahl schließen">×</button>
    </div>
    <p class="helper-copy">${escapeHtml(portalMessage("portal.useShiftDragForMultipleSelectionLockedStartingNodes", "Use Shift + drag for multiple selection. Locked starting nodes remain protected."))}</p>
    <div class="before-after">
      <span>${escapeHtml(portalMessage("portal.selection", "Selection"))}</span>
      <strong data-i18n-ignore>${escapeHtml(labels || portalMessage("portal.noEditableNodes", "No editable nodes"))}${editableNodes.length > 5 ? " …" : ""}</strong>
      <span>${escapeHtml(portalMessage("portal.editable", "Editable"))}</span>
      <strong>${escapeHtml(portalMessage("portal.valueOfValue", "{p3} of {p4}", { p3: editableNodes.length, p4: nodes.length }))}</strong>
    </div>
    <form class="action-form" id="bulk-node-form">
      <label>Alle änderbaren Kacheln auf Ziel setzen
        ${renderTargetSelect("bulk-target-select", "", "", true, ["portal.setTheTargetForAllEditableNodes", "Set the target for all editable nodes"])}
      </label>
    </form>
    <div class="helper-actions">
      <button class="secondary-button" id="delete-selected-nodes" type="button" ${editableNodes.length ? "" : "disabled"}>${escapeHtml(portalMessage("portal.deleteSelection", "Delete selection"))}</button>
    </div>
  `;
}

function renderTimeControlBranchHelper(node, did, validation) {
  const field = state.selectedBranchField;
  const isClosed = field === "closedTarget";
  const label = isClosed ? portalMessage("portal.outsideOpeningHours", "Outside opening hours") : portalMessage("portal.server.insideOpeningHours", "Inside opening hours");
  return `
    <div class="helper-header">
      <h3>Pfad: ${escapeHtml(label)}</h3>
      <button class="helper-close-button" id="close-flow-helper" type="button" aria-label="Eigenschaften schließen">×</button>
    </div>
    <p class="helper-copy">${escapeHtml(portalMessage("portal.thisTimeControlOutputCanLeadToAQueue", "This time-control output can lead to a queue, announcement, voice dialog, extension or further steps."))}</p>
    <div class="before-after">
      <span>${escapeHtml(portalMessage("portal.timeControl", "Time control"))}</span>
      <strong data-i18n-ignore>${escapeHtml(node.title)} · ${escapeHtml(node.config?.hours || portalMessage("portal.timeWindowMissing", "Time window missing"))}</strong>
      <span>${escapeHtml(portalMessage("portal.path", "Path"))}</span>
      <strong data-i18n-ignore>${escapeHtml(label)} → ${escapeHtml(node.config?.[field]?.title || portalMessage("portal.selectTarget", "Select target"))}</strong>
    </div>
    <form class="action-form" id="node-form">
      <label${requiredFieldClass(isMissingFlowNode(branchTargetNode(node, field)) && !(isClosed && node.config?.announcement))}>Ziel für diesen Pfad
        ${renderTargetSelect("", field, targetConfigValue(node.config?.[field]), true, ["portal.targetForThisPath", "Target for this path"])}
      </label>
      ${isClosed ? `
        <label>Optionale Ansage vor dem Ziel
          ${renderAnnouncementSelect(node.config?.announcement || "", ["portal.optionalAnnouncementBeforeTheTarget", "Optional announcement before the target"])}
        </label>
      ` : ""}
    </form>
    <div class="helper-actions">
      <button class="secondary-button" data-branch-back="${escapeHtml(node.id)}" type="button">${escapeHtml(portalMessage("portal.editTimeControl", "Edit time control"))}</button>
    </div>
    <div class="validation-box">
      <strong>Status</strong>
      <span>${portalMessagesMarkup(validation.checks)}</span>
    </div>
  `;
}

function isSelectableTargetKind(kind) {
  return ["PLACEHOLDER", "PHONEEXTENSION", "QUEUE", "FRONTDESK", "GROUP", "SKILL", "VOICEMAIL"].includes(normalizeTargetType(kind));
}

function isComplexStepKind(kind) {
  return ["TIMECONTROL", "IVR", "ANNOUNCEMENT", "HANGUP"].includes(normalizeTargetType(kind));
}

function usesGenericTargetEditor(node) {
  return Boolean(node?.isTarget) && !isComplexStepKind(node.type);
}

function isPortalInventoryTargetKind(kind) {
  return ["PHONEEXTENSION", "PHONE", "QUEUE", "FRONTDESK", "GROUP", "SKILL", "VOICEMAIL"].includes(normalizeTargetType(kind));
}

function usesDerivedTargetName(node) {
  return Boolean(node && !node.locked && isPortalInventoryTargetKind(node.type) && currentTargetValue(node));
}

function nodeValidationIssues(node) {
  if (!node || node.locked || node.isTarget) return [];
  ensureNodeConfig(node);
  const kind = normalizeTargetType(node.type);
  const issues = [];

  if (kind === "PLACEHOLDER") issues.push(portalMessage("portal.stepTypeMissing", "Step type missing"));

  if (kind === "TIMECONTROL") {
    if (!node.config.portalMode) {
      issues.push(portalMessage("portal.chooseNewOrExisting", "Choose new or existing"));
    } else if (node.config.portalMode === "existing") {
      if (!(node.routeNumber || node.targetNumber)) issues.push(portalMessage("portal.existingTimeControlMissing", "Existing time control missing"));
    } else {
      if (!node.config.hours) issues.push(portalMessage("portal.timeWindowMissing", "Time window missing"));
      if (isMissingFlowNode(branchTargetNode(node, "openTarget"))) issues.push(portalMessage("portal.targetInsideOpeningHoursMissing", "Target inside opening hours missing"));
      if (isMissingFlowNode(branchTargetNode(node, "closedTarget")) && !node.config.announcement) {
        issues.push(portalMessage("portal.targetOutsideOpeningHoursMissing", "Target outside opening hours missing"));
      }
    }
  }

  if (kind === "IVR") {
    if (!node.config.portalMode) {
      issues.push(portalMessage("portal.chooseNewOrExisting", "Choose new or existing"));
    } else if (node.config.portalMode === "existing") {
      if (!(node.routeNumber || node.targetNumber)) issues.push(portalMessage("portal.existingVoiceDialogMissing", "Existing voice dialog missing"));
    } else {
      if (!node.config.announcement) issues.push(portalMessage("portal.announcementMissing", "Announcement missing"));
      if (!ivrKeyNumbers(node).some((key) => !isMissingFlowNode(branchTargetNode(node, ivrTargetField(key))))) {
        issues.push(portalMessage("portal.keyTargetMissing", "Key target missing"));
      }
      if (isMissingFlowNode(branchTargetNode(node, "timeoutTarget"))) issues.push(portalMessage("portal.timeoutTargetMissing", "Timeout target missing"));
    }
  }

  if (kind === "ANNOUNCEMENT" && !node.config.announcement) issues.push(portalMessage("portal.announcementMissing", "Announcement missing"));

  if (kind === "QUEUE" && node.config.timeoutSeconds && isMissingFlowNode(branchTargetNode(node, "timeoutTarget"))) {
    issues.push(portalMessage("portal.timeoutTargetMissing", "Timeout target missing"));
  }
  if (["QUEUE", "GROUP", "SKILL"].includes(kind)) {
    if (!node.config.portalMode) issues.push(portalMessage("portal.chooseNewOrExisting", "Choose new or existing"));
    if (node.config.portalMode === "existing" && !(node.routeNumber || node.targetNumber)) {
      issues.push(portalMessage("portal.existingValueMissing", "Existing {p0} missing", { p0: readableNodeType(kind) }));
    }
  }

  return issues;
}

function requiredFieldClass(isMissing) {
  return isMissing ? ` class="is-required-missing"` : "";
}

function renderNodeConfiguration(node) {
  const kind = normalizeTargetType(node.type);
  if (RESOURCE_STEP_KINDS.has(kind)) {
    return renderResourceNodeConfiguration(node, kind);
  }
  if (isSelectableTargetKind(kind)) {
    const timeoutControls = kind === "QUEUE" ? `
      <label>Timeout nach Sekunden
        <input data-node-config-field="timeoutSeconds" type="number" min="0" step="5" value="${escapeHtml(node.config?.timeoutSeconds || "")}" ${portalPlaceholderAttributes("portal.eG120", "e.g. 120")}>
      </label>
      <label${requiredFieldClass(Boolean(node.config?.timeoutSeconds) && isMissingFlowNode(branchTargetNode(node, "timeoutTarget")))}>Nach Timeout
        ${renderTargetSelect("", "timeoutTarget", targetConfigValue(node.config?.timeoutTarget), true)}
      </label>
    ` : "";
    return `
      <label>Vorhandenes Ziel wählen
        ${renderTargetSelect("target-select", "", currentTargetValue(node), true)}
      </label>
      ${timeoutControls}
    `;
  }

  if (usesGenericTargetEditor(node)) {
    return `
      <label>Vorhandenes Ziel wählen
        ${renderTargetSelect("target-select", "", currentTargetValue(node), true)}
      </label>
    `;
  }

  if (kind === "TIMECONTROL") {
    return `
      <label${requiredFieldClass(!node.config?.hours)}>Zeitfenster
        <input data-node-config-field="hours" value="${escapeHtml(node.config?.hours || portalMessage("portal.monFri08001700", "Mon-Fri 08:00-17:00"))}">
      </label>
      <div class="branch-summary">
        <strong>${escapeHtml(portalMessage("portal.outputs", "Outputs"))}</strong>
        <span>${escapeHtml(portalMessage("portal.inside", "Inside"))}</span>
        <span>${escapeHtml(portalMessage("portal.outside_a5443", "Outside"))}</span>
      </div>
    `;
  }

  if (kind === "IVR") {
    const keys = ivrKeyNumbers(node);
    const keyFields = keys.map((key) => `
      <label${requiredFieldClass(isMissingFlowNode(branchTargetNode(node, ivrTargetField(key))))}>${escapeHtml(portalMessage("portal.keyValue", "Key {p0}", { p0: key }))}
        ${renderTargetSelect("", ivrTargetField(key), targetConfigValue(node.config?.[ivrTargetField(key)]), true)}
      </label>
    `).join("");
    const nextKey = nextIvrKey(node);
    return `
      <label${requiredFieldClass(!node.config?.announcement)}>Ansage vor der Auswahl
        ${renderAnnouncementSelect(node.config?.announcement || "", ["portal.announcementBeforeSelection", "Announcement before selection"])}
      </label>
      ${keyFields}
      <button class="secondary-button" data-add-ivr-key="${escapeHtml(node.id)}" type="button" ${nextKey ? "" : "disabled"}>${escapeHtml(portalMessage("portal.addKey", "Add key"))}</button>
      <label${requiredFieldClass(isMissingFlowNode(branchTargetNode(node, "timeoutTarget")))}>Keine Eingabe / Timeout
        ${renderTargetSelect("", "timeoutTarget", targetConfigValue(node.config?.timeoutTarget), true, ["portal.noInputTimeout", "No input / timeout"])}
      </label>
    `;
  }

  if (kind === "ANNOUNCEMENT") {
    return `
      <label${requiredFieldClass(!node.config?.announcement)}>Ansage
        ${renderAnnouncementSelect(node.config?.announcement || "")}
      </label>
      <label>Danach weiterleiten an
        ${renderTargetSelect("", "afterTarget", targetConfigValue(node.config?.afterTarget), true)}
      </label>
    `;
  }

  if (kind === "HANGUP") {
    return `
      <label>Aktion
        <input ${portalDefaultAttributes("portal.theCallEndsAfterThisStep", "The call ends after this step.")} disabled>
      </label>
    `;
  }

  return `
    <label>Weiterleitung an
      <input data-node-field="subtitle" value="${escapeHtml(node.subtitle)}" ${node.locked ? "disabled" : ""}>
    </label>
  `;
}

function resourceMode(node) {
  return node?.config?.portalMode || "";
}

function renderResourceSourceChoice(node, kind) {
  const mode = resourceMode(node);
  const resource = ({ QUEUE: "Queue", GROUP: "SkillGroup", SKILL: "SkillGroup", IVR: "VoiceDialog", TIMECONTROL: "TimeControl" })[kind];
  const label = ({ Queue: "queue", SkillGroup: "skill group", VoiceDialog: "voice dialog", TimeControl: "time control" })[resource];
  const createKey = `portal.createNew${resource}`;
  const selectKey = `portal.selectExisting${resource}`;
  return `
    <label${requiredFieldClass(!mode)}>Quelle
      <select data-node-config-field="portalMode">
        <option value="" ${!mode ? "selected" : ""}>${escapeHtml(portalMessage("portal.chooseNewOrExisting", "Choose new or existing"))}</option>
        <option value="new" ${mode === "new" ? "selected" : ""} data-i18n-key="${createKey}">${escapeHtml(portalMessage(createKey, `Create new ${label}`))}</option>
        <option value="existing" ${mode === "existing" ? "selected" : ""} data-i18n-key="${selectKey}">${escapeHtml(portalMessage(selectKey, `Select existing ${label}`))}</option>
      </select>
    </label>
  `;
}

function renderResourceTargetSelect(kind, selectedValue = "") {
  const options = targetOptions().filter((target) => normalizeTargetType(target.kind) === kind);
  return `
    <select data-node-resource-target="${escapeHtml(kind)}">
      <option value="">${escapeHtml(portalMessage("portal.selectExistingPortalTarget", "Select existing Portal target"))}</option>
      ${options.map((target) => `
        <option value="${escapeHtml(target.value)}" ${targetOptionSelected(target.value, selectedValue) ? "selected" : ""} data-i18n-ignore data-portal-target-option>${escapeHtml(target.label)}</option>
      `).join("")}
    </select>
  `;
}

function renderResourceNodeConfiguration(node, kind) {
  const mode = resourceMode(node);
  const sourceChoice = renderResourceSourceChoice(node, kind);
  if (!mode) {
    return `${sourceChoice}<p class="field-note">${escapeHtml(portalMessage("portal.chooseWhetherThisStepCreatesANewPortalObject", "Choose whether this step creates a new Portal object or uses an existing target."))}</p>`;
  }
  if (mode === "existing") {
    return `
      ${sourceChoice}
      <label${requiredFieldClass(!currentTargetValue(node))}>Vorhandenes Portal-Ziel
        ${renderResourceTargetSelect(kind, currentTargetValue(node))}
      </label>
    `;
  }
  if (kind === "QUEUE" || kind === "GROUP" || kind === "SKILL") {
    const timeoutControls = kind === "QUEUE" ? `
      <label>Timeout nach Sekunden
        <input data-node-config-field="timeoutSeconds" type="number" min="0" step="5" value="${escapeHtml(node.config?.timeoutSeconds || "")}" ${portalPlaceholderAttributes("portal.eG120", "e.g. 120")}>
      </label>
      <label${requiredFieldClass(Boolean(node.config?.timeoutSeconds) && isMissingFlowNode(branchTargetNode(node, "timeoutTarget")))}>Nach Timeout
        ${renderTargetSelect("", "timeoutTarget", targetConfigValue(node.config?.timeoutTarget), true)}
      </label>
    ` : "";
    return `
      ${sourceChoice}
      ${timeoutControls}
    `;
  }
  if (kind === "TIMECONTROL") {
    return `
      ${sourceChoice}
      <label${requiredFieldClass(!node.config?.hours)}>Zeitfenster
        <input data-node-config-field="hours" value="${escapeHtml(node.config?.hours || "")}" ${portalPlaceholderAttributes("portal.eGMonFri08001700", "e.g. Mon-Fri 08:00-17:00")}>
      </label>
      <label${requiredFieldClass(isMissingFlowNode(branchTargetNode(node, "openTarget")))}>Ziel innerhalb
        ${renderTargetSelect("", "openTarget", targetConfigValue(node.config?.openTarget), true)}
      </label>
      <label${requiredFieldClass(isMissingFlowNode(branchTargetNode(node, "closedTarget")) && !node.config?.announcement)}>Ziel außerhalb
        ${renderTargetSelect("", "closedTarget", targetConfigValue(node.config?.closedTarget), true)}
      </label>
      <div class="branch-summary">
        <strong>${escapeHtml(portalMessage("portal.outputs", "Outputs"))}</strong>
        <span>${escapeHtml(portalMessage("portal.inside", "Inside"))}</span>
        <span>${escapeHtml(portalMessage("portal.outside_a5443", "Outside"))}</span>
      </div>
    `;
  }
  if (kind === "IVR") {
    const keys = ivrKeyNumbers(node);
    const keyFields = keys.map((key) => `
      <label${requiredFieldClass(isMissingFlowNode(branchTargetNode(node, ivrTargetField(key))))}>${escapeHtml(portalMessage("portal.keyValue", "Key {p0}", { p0: key }))}
        ${renderTargetSelect("", ivrTargetField(key), targetConfigValue(node.config?.[ivrTargetField(key)]), true)}
      </label>
    `).join("");
    const nextKey = nextIvrKey(node);
    return `
      ${sourceChoice}
      <label${requiredFieldClass(!node.config?.announcement)}>Ansage vor der Auswahl
        ${renderAnnouncementSelect(node.config?.announcement || "", ["portal.announcementBeforeSelection", "Announcement before selection"])}
      </label>
      ${keyFields}
      <button class="secondary-button" data-add-ivr-key="${escapeHtml(node.id)}" type="button" ${nextKey ? "" : "disabled"}>${escapeHtml(portalMessage("portal.addKey", "Add key"))}</button>
      <label${requiredFieldClass(isMissingFlowNode(branchTargetNode(node, "timeoutTarget")))}>Keine Eingabe / Timeout
        ${renderTargetSelect("", "timeoutTarget", targetConfigValue(node.config?.timeoutTarget), true, ["portal.noInputTimeout", "No input / timeout"])}
      </label>
    `;
  }
  return sourceChoice;
}

function renderTargetSelect(id, configField, selectedValue = "", allowHangup = false, label = null) {
  const idAttribute = id ? ` id="${escapeHtml(id)}"` : "";
  const dataAttribute = configField ? ` data-node-target-config="${escapeHtml(configField)}"` : "";
  const options = targetOptions().filter(target => !allowHangup || normalizeTargetType(target.kind) !== "HANGUP");
  let selectedTarget = null;
  try { selectedTarget = JSON.parse(selectedValue); } catch { /* No selected target. */ }
  const selectedIsHangup = allowHangup && normalizeTargetType(selectedTarget?.type) === "HANGUP";
  // New nested steps have no inventory identity yet; keep their full draft as the current option.
  if (selectedTarget?.type && !selectedIsHangup && !options.some(target => targetOptionSelected(target.value, selectedValue))) {
    options.unshift({ value: selectedValue, label: targetOptionLabel(selectedTarget.targetNumber || selectedTarget.number || "", selectedTarget.type, selectedTarget.title) });
  }
  const hangupOption = allowHangup
    ? `<option value="${escapeHtml(JSON.stringify({ type: "HANGUP", title: portalMessage("portal.hangUp", "Hang up"), subtitle: portalMessage("portal.endCall", "End call"), tone: "muted" }))}" ${selectedIsHangup ? "selected" : ""}>${escapeHtml(portalMessage("portal.hangUpEndCall", "Hang up (end call)"))}</option>`
    : "";
  return `
    <span class="select-search-stack">
      <input class="select-filter-input" type="search" ${portalPlaceholderAttributes("portal.searchTarget_fc750", "Search target...")} ${portalSelectLabelAttributes("portal.searchTarget", "Search target")}>
      <select${idAttribute}${dataAttribute} ${targetSelectLabelAttributes(configField, label)}>
        <option value="">${escapeHtml(portalMessage("portal.selectTarget", "Select target"))}</option>
        ${hangupOption}
        ${options.map((target) => `
          <option value="${escapeHtml(target.value)}" ${targetOptionSelected(target.value, selectedValue) ? "selected" : ""} data-i18n-ignore data-portal-target-option>${escapeHtml(target.label)}</option>
        `).join("")}
      </select>
    </span>
  `;
}

function targetOptionSelected(optionValue, selectedValue) {
  if (!selectedValue) return false;
  if (optionValue === selectedValue) return true;
  try {
    const option = JSON.parse(optionValue);
    const selected = JSON.parse(selectedValue);
    if (normalizeTargetType(option?.type) === "HANGUP" && normalizeTargetType(selected?.type) === "HANGUP") return true;
    if (![option, selected].every(target => [target?.href, target?.routeNumber, target?.number, target?.targetNumber].some(value => value != null && String(value).trim() !== ""))) return false;
    return sameTargetIdentity(option, selected);
  } catch {
    return false;
  }
}

function renderAnnouncementSelect(selectedValue = "", label = ["portal.announcement", "Announcement"]) {
  const announcements = getOverview()?.inventory?.announcements || [];
  if (!announcements.length) {
    return `<input data-node-config-field="announcement" value="${escapeHtml(selectedValue)}" ${portalPlaceholderAttributes("portal.createAnAnnouncementInThePortalOrEnterIts", "Create an announcement in the Portal or enter its name")} ${portalSelectLabelAttributes(...label)}>`;
  }
  return `
    <span class="select-search-stack">
      <input class="select-filter-input" type="search" ${portalPlaceholderAttributes("portal.searchAnnouncement_f13ad", "Search announcement...")} ${portalSelectLabelAttributes("portal.searchAnnouncement", "Search announcement")}>
      <select data-node-config-field="announcement" ${portalSelectLabelAttributes(...label)}>
        <option value="">${escapeHtml(portalMessage("portal.selectAnnouncement", "Select announcement"))}</option>
        ${announcements.map((announcement) => {
          const value = announcement.name || announcement.value || announcement.id;
          return `<option value="${escapeHtml(value)}" ${value === selectedValue ? "selected" : ""} data-i18n-ignore>${escapeHtml(value)}</option>`;
        }).join("")}
      </select>
    </span>
  `;
}

function flowRoutingConflicts(flow) {
  const nodes = flow?.nodes || [];
  const outputs = new Map();
  for (const edge of flow?.edges || []) {
    if (edge.virtual) continue;
    const source = nodes.find(node => node.id === edge.from);
    const isStart = source?.id === "inbound" || ["DID", "TRUNK"].includes(normalizeTargetType(source?.type));
    const field = isStart ? "" : edge.branchField || "";
    const key = JSON.stringify([edge.from, field]);
    const output = outputs.get(key) || { count: 0, kind: isStart ? "start" : field ? "branch" : "direct" };
    output.count += 1;
    outputs.set(key, output);
  }
  const conflicts = new Set([...outputs.values()].filter(output => output.count > 1).map(output => output.kind));
  // Stable priority makes old drafts fail the same way regardless of edge order.
  return ["start", "branch", "direct"].filter(kind => conflicts.has(kind));
}

function flowRoutingConflictMessage(kind) {
  if (kind === "start") return portalMessage("portal.flowMultipleStartConnections", "The callflow has multiple start connections. Keep exactly one outgoing connection from the incoming call.");
  if (kind === "branch") return portalMessage("portal.flowMultipleBranchTargets", "A callflow branch has multiple targets. Keep exactly one target per key or branch.");
  return portalMessage("portal.flowMultipleDirectTargets", "A callflow step has multiple direct targets. Keep exactly one outgoing connection for that step.");
}

function flowStartNode(flow = state.flow) {
  if (flowRoutingConflicts(flow).length) return null;
  const nodes = flow?.nodes || [];
  const edges = flow?.edges || [];
  let node = nodes.find(item => item.id === "inbound")
    || nodes.find(item => item.locked && normalizeTargetType(item.type) === "DID")
    || nodes.find(item => item.locked);
  if (!node) return nodes.find(item => !item.floating && !item.branchTarget && !edges.some(edge => edge.to === item.id)) || null;
  const visited = new Set();
  while (node?.locked || normalizeTargetType(node?.type) === "TRUNK") {
    if (visited.has(node.id)) return null;
    visited.add(node.id);
    const edge = edges.find(item => item.from === node.id && !item.virtual && !item.branchField);
    node = nodes.find(item => item.id === edge?.to);
  }
  return node || null;
}

function currentDraftTarget() {
  const conflict = flowRoutingConflicts(state.flow)[0];
  if (conflict) return flowRoutingConflictMessage(conflict);
  const flowStep = flowStartNode();
  if (flowStep) {
    ensureNodeConfig(flowStep);
    const kind = normalizeTargetType(flowStep.type);
    if (kind === "TIMECONTROL") {
      if (flowStep.config?.portalMode === "existing") return portalMessage("portal.valueExistingTimeControl", "{p0}: existing time control", { p0: flowStep.title });
      const openNode = branchTargetNode(flowStep, "openTarget");
      const closedNode = branchTargetNode(flowStep, "closedTarget");
      const open = isMissingFlowNode(openNode) ? portalMessage("portal.targetMissing", "Target missing") : openNode.title;
      const closed = isMissingFlowNode(closedNode)
        ? (flowStep.config.announcement ? portalMessage("portal.valueHangUp", "{p0} + hang up", { p0: flowStep.config.announcement }) : portalMessage("portal.targetMissing", "Target missing"))
        : closedNode.title;
      return portalMessage("portal.valueInsideValueOutsideValue", "{p0}: inside {p1} / outside {p2}", { p0: flowStep.title, p1: open, p2: closed });
    }
    if (kind === "IVR") {
      if (flowStep.config?.portalMode === "existing") return portalMessage("portal.valueExistingVoiceDialog", "{p0}: existing voice dialog", { p0: flowStep.title });
      const timeoutNode = branchTargetNode(flowStep, "timeoutTarget");
      const keys = ivrKeyNumbers(flowStep)
        .map((key) => {
          const keyNode = branchTargetNode(flowStep, ivrTargetField(key));
          return `${key} ${isMissingFlowNode(keyNode) ? portalMessage("portal.targetMissing", "Target missing") : keyNode.title}`;
        })
        .join(" / ");
      const timeout = isMissingFlowNode(timeoutNode) ? portalMessage("portal.timeoutMissing", "Timeout missing") : timeoutNode.title;
      return `${flowStep.title}: ${keys} / Timeout ${timeout}`;
    }
    if (kind === "ANNOUNCEMENT") {
      const afterNode = branchTargetNode(flowStep, "afterTarget");
      const after = isMissingFlowNode(afterNode) ? portalMessage("portal.hangUp", "Hang up") : afterNode.title;
      return `${flowStep.title}: ${flowStep.config.announcement || portalMessage("portal.announcementMissing", "Announcement missing")} → ${after}`;
    }
    if (["QUEUE", "GROUP", "SKILL"].includes(kind) && flowStep.config?.portalMode === "new") {
      return portalMessage("portal.valueCreateNew", "{p0}: create new", { p0: flowStep.title });
    }
    if (kind === "QUEUE" && flowStep.config.timeoutSeconds) {
      const timeoutNode = branchTargetNode(flowStep, "timeoutTarget");
      const timeout = isMissingFlowNode(timeoutNode) ? portalMessage("portal.timeoutMissing", "Timeout missing") : timeoutNode.title;
      return `${flowStep.title}: Timeout ${flowStep.config.timeoutSeconds}s → ${timeout}`;
    }
    if (kind === "HANGUP") return portalMessage("portal.valueHangUp_bce31", "{p0}: hang up", { p0: flowStep.title });
  }
  const target = flowStep;
  if (!target) return portalMessage("portal.noTarget_1186c", "No target");
  return [target.title, target.subtitle].filter(Boolean).join(" · ");
}

function targetConfigValue(target = null) {
  if (!target) return "";
  const value = {
    type: target.type,
    title: target.title,
    titleUserEdited: Boolean(target.titleUserEdited),
    _i18nDefaults: target._i18nDefaults ? clone(target._i18nDefaults) : {},
    subtitle: target.subtitle,
    targetNumber: target.targetNumber || target.number || "",
    routeNumber: target.routeNumber || "",
    href: target.href || "",
    tone: target.tone || targetTone(target.type),
  };
  if (target.config && Object.keys(target.config).length) value.config = clone(target.config);
  return JSON.stringify(value);
}

function currentTargetValue(node) {
  return targetOptions().find((option) => {
    try {
      return sameTargetIdentity(JSON.parse(option.value), node);
    } catch {
      return false;
    }
  })?.value || "";
}

function nodeHasExistingPortalTarget(node) {
  const kind = normalizeTargetType(node?.type);
  if (!RESOURCE_STEP_KINDS.has(kind)) return false;
  return Boolean(
    node.routeNumber
    || node.targetNumber
    || node.config?.branchSource === "verified-live"
    || (["QUEUE", "GROUP", "SKILL"].includes(kind) && serviceForFlowNode(node))
  );
}

function nodePortalMode(node) {
  return node?.config?.portalMode || (nodeHasExistingPortalTarget(node) ? "existing" : "");
}

function ensureNodeConfig(node) {
  const kind = normalizeTargetType(node?.type);
  node.config ||= {};
  if (RESOURCE_STEP_KINDS.has(kind) && !node.config.portalMode && nodeHasExistingPortalTarget(node)) {
    node.config.portalMode = "existing";
  }
  if (kind === "IVR") {
    node.config.announcement ||= "";
    node.config.ivrKeys = ivrKeyNumbers(node);
  }
  if (kind === "ANNOUNCEMENT") {
    node.config.announcement ||= "";
  }
  if (kind === "QUEUE") {
    node.config.timeoutSeconds ||= "";
  }
}

function targetOptions() {
  const overview = getOverview();
  const queues = (overview?.inventory?.queues || []).map((queue) => ({
    label: targetOptionLabel(queue.extensionNumber || queue.value, "QUEUE", queue.name),
    kind: "QUEUE",
    value: JSON.stringify(flowTargetFromApiTarget({
      type: "QUEUE",
      title: queue.name,
      subtitle: (queue.extensionNumber || queue.value) ? portalMessage("portal.queueValue", "Queue {p0}", { p0: queue.extensionNumber || queue.value }) : portalMessage("portal.queue", "Queue"),
      targetNumber: queue.extensionNumber || queue.value || "",
      routeNumber: queue.serviceNumber || queue.id || queue.value || "",
      tone: targetTone("QUEUE"),
      ...serviceMetaFor("queue", queue),
    })),
  }));
  const skills = (overview?.inventory?.skills || []).map((skill) => ({
    label: targetOptionLabel(skill.extensionNumber || skill.value, "SKILL", skill.name),
    kind: "SKILL",
    value: JSON.stringify(flowTargetFromApiTarget({
      type: "SKILL",
      title: skill.name,
      subtitle: (skill.extensionNumber || skill.value) ? portalMessage("portal.skillGroupValue", "Skill group {p0}", { p0: skill.extensionNumber || skill.value }) : portalMessage("portal.skillGroup", "Skill group"),
      targetNumber: skill.extensionNumber || skill.value || "",
      routeNumber: skill.serviceNumber || skill.id || skill.value || "",
      tone: targetTone("SKILL"),
      ...serviceMetaFor("skill", skill),
    })),
  }));
  const ivrs = (overview?.inventory?.ivrs || []).map((ivr) => ({
    label: targetOptionLabel(ivr.value, "IVR", ivr.name),
    kind: "IVR",
    value: JSON.stringify(flowTargetFromApiTarget({
      type: "IVR",
      title: ivr.name,
      subtitle: ivr.value ? portalMessage("portal.voiceDialogValue", "Voice dialog {p0}", { p0: ivr.value }) : portalMessage("portal.voiceDialog", "Voice dialog"),
      targetNumber: ivr.value || "",
      routeNumber: ivr.serviceNumber || ivr.id || ivr.value || "",
      tone: targetTone("IVR"),
    })),
  }));
  const timeControls = (overview?.inventory?.timeControls || []).map((timeControl) => ({
    label: targetOptionLabel(timeControl.value, "TIMECONTROL", timeControl.name),
    kind: "TIMECONTROL",
    value: JSON.stringify(flowTargetFromApiTarget({
      type: "TIMECONTROL",
      title: timeControl.name,
      subtitle: timeControl.value ? portalMessage("portal.timeControlValue", "Time control {p0}", { p0: timeControl.value }) : portalMessage("portal.timeControl", "Time control"),
      targetNumber: timeControl.value || "",
      routeNumber: timeControl.serviceNumber || timeControl.id || timeControl.value || "",
      tone: targetTone("TIMECONTROL"),
    })),
  }));
  const voicemails = [
    ...(overview?.inventory?.voicemails || []).map((voicemail) => ({
      label: targetOptionLabel(voicemail.extensionNumber || voicemail.value, "VOICEMAIL", voicemail.name),
      kind: "VOICEMAIL",
      value: JSON.stringify({
        type: "VOICEMAIL",
        title: voicemail.name,
        subtitle: (voicemail.extensionNumber || voicemail.value) ? portalMessage("portal.voicemailValue", "Voicemail {p0}", { p0: voicemail.extensionNumber || voicemail.value }) : portalMessage("portal.voicemail", "Voicemail"),
        targetNumber: voicemail.extensionNumber || voicemail.value || "",
        routeNumber: voicemail.serviceNumber || voicemail.id || voicemail.value || "",
        href: voicemail.href || "",
        tone: targetTone("VOICEMAIL"),
      }),
    })),
    ...(overview?.inventory?.extensions || [])
      .filter((extension) => extension.voicemailHref || extension.voicemailNumber)
      .map((extension) => ({
        label: targetOptionLabel(extension.number, "VOICEMAIL", portalMessage("portal.valueVoicemail", "{p0} voicemail", { p0: extension.name })),
        kind: "VOICEMAIL",
        value: JSON.stringify({
          type: "VOICEMAIL",
          title: portalMessage("portal.valueVoicemail", "{p0} voicemail", { p0: extension.name }),
          subtitle: portalMessage("portal.voicemailValue", "Voicemail {p0}", { p0: extension.number }),
          targetNumber: extension.number,
          routeNumber: extension.voicemailNumber || extension.number,
          href: extension.voicemailHref || "",
        tone: targetTone("VOICEMAIL"),
      }),
    })),
  ];
  const frontdesks = (overview?.inventory?.frontdesks || []).map((frontdesk) => ({
    label: targetOptionLabel(frontdesk.extensionNumber || frontdesk.value, "FRONTDESK", frontdesk.name),
    kind: "FRONTDESK",
    value: JSON.stringify({
      type: "FRONTDESK",
      title: frontdesk.name,
      subtitle: (frontdesk.extensionNumber || frontdesk.value) ? `Frontdesk ${frontdesk.extensionNumber || frontdesk.value}` : "Frontdesk",
      targetNumber: frontdesk.extensionNumber || frontdesk.value || "",
      routeNumber: frontdesk.serviceNumber || frontdesk.id || frontdesk.value || "",
      href: frontdesk.href || "",
      serviceCode: frontdesk.serviceCode || "",
      tone: targetTone("FRONTDESK"),
    }),
  }));
  const routedTargets = (overview?.inventory?.dids || [])
    .filter((did) => did.value)
    .map((did) => {
      const target = {
        type: did.destinationType || "PHONEEXTENSION",
        title: did.value,
        subtitle: did.destinationExtension ? `${targetTypeLabel(did.destinationType)} ${did.destinationExtension}` : targetTypeLabel(did.destinationType),
        targetNumber: did.destinationExtension || "",
        routeNumber: did.destinationServiceNumber || did.destinationExtension || "",
        tone: targetTone(did.destinationType),
        ...serviceMetaForTarget(did.destinationType, did.destinationServiceNumber, did.destinationExtension, did.destinationName || did.value),
      };
      const kind = String(did.destinationType || "").toUpperCase();
      return {
        label: targetOptionLabel(did.destinationExtension, did.destinationType, did.value), kind,
        value: JSON.stringify(["QUEUE", "SKILL"].includes(kind) ? flowTargetFromApiTarget(target) : target),
      };
    });
  const extensions = (overview?.inventory?.extensions || []).map((extension) => ({
    label: targetOptionLabel(extension.number, "PHONEEXTENSION", extension.name),
    kind: "PHONEEXTENSION",
    value: JSON.stringify({
      type: "PHONEEXTENSION",
      title: extension.name,
      subtitle: portalMessage("portal.extensionValue", "Extension {p0}", { p0: extension.number }),
      targetNumber: extension.number,
      routeNumber: extension.number,
      href: extension.href || "",
      tone: "green",
    }),
  }));
  const queueTargets = routedTargets.filter((target) => target.kind === "QUEUE");
  const groupTargets = routedTargets.filter((target) => ["GROUP", "SKILL"].includes(target.kind));
  const otherRoutedTargets = routedTargets.filter((target) => !["QUEUE", "GROUP", "SKILL"].includes(target.kind));
  const targets = [...queueTargets, ...queues, ...groupTargets, ...skills, ...frontdesks, ...ivrs, ...timeControls, ...voicemails, ...otherRoutedTargets, ...extensions];
  const seen = new Set();
  return targets.filter((target) => {
    let parsed = {};
    try {
      parsed = JSON.parse(target.value);
    } catch {
      parsed = {};
    }
    const key = `${parsed.type || target.kind || ""}:${String(parsed.routeNumber || parsed.targetNumber || parsed.title || target.label).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort(compareTargetOptions).slice(0, 80);
}

function parsedTargetOptions() {
  return targetOptions().map((option) => {
    try {
      return { option, target: JSON.parse(option.value) };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function daynightTargetOptions({ includeCreateOption = true } = {}) {
  const hangup = {
    label: portalMessage("portal.hangUpEndCall_f2853", "Hang up - (End call)"),
    kind: "HANGUP",
    value: JSON.stringify({ type: "HANGUP", title: portalMessage("portal.hangUp", "Hang up"), routeNumber: "HANGUP", number: "HANGUP" }),
  };
  const newDialog = {
    label: portalMessage("portal.createNewNightTargetAnnouncementNextStep", "Create new night target - (announcement + next step)"),
    kind: "NEW_NIGHT_TARGET",
    value: JSON.stringify({ type: "NEW_NIGHT_TARGET", title: portalMessage("portal.createNewNightTarget", "Create new night target"), routeNumber: "", number: "" }),
  };
  const generatedGatewayName = /^TN\s+\+/i;
  return [
    hangup,
    ...(includeCreateOption ? [newDialog] : []),
    ...targetOptions().filter((option) => {
      try {
        const target = JSON.parse(option.value);
        return !(normalizeTargetType(target.type) === "TIMECONTROL" && generatedGatewayName.test(String(target.title || option.label || "")));
      } catch {
        return true;
      }
    }),
  ];
}

function daynightAnnouncementOptions() {
  return getOverview()?.inventory?.announcements || [];
}

function selectedAnnouncementName() {
  const announcements = daynightAnnouncementOptions();
  if (!state.daynightAnnouncementName && announcements[0]) {
    state.daynightAnnouncementName = announcements[0].name || announcements[0].value || announcements[0].id || "";
  }
  return state.daynightAnnouncementName;
}

function selectedAnnouncementAfterValue() {
  const options = daynightTargetOptions({ includeCreateOption: false });
  if (!state.daynightAnnouncementAfterValue) {
    state.daynightAnnouncementAfterValue = options[0]?.value || "";
  }
  return state.daynightAnnouncementAfterValue;
}

function parsedDaynightTargetOptions() {
  return daynightTargetOptions().map((option) => {
    try {
      return { option, target: JSON.parse(option.value) };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function ensureProfileTargetValue(choices = parsedTargetOptions()) {
  const saved = getOverview()?.daynight?.nightTarget;
  const preferred = saved && choices.find(({target}) => target.href === saved.href || (normalizeTargetType(target.type) === normalizeTargetType(saved.type) && String(target.routeNumber || target.targetNumber || "") === String(saved.routeNumber || saved.number || "")));
  if (!choices.some(({ option }) => option.value === state.profileTargetValue)) {
    let current;
    try { current = JSON.parse(state.profileTargetValue); } catch { /* No selected target. */ }
    const matches = current ? choices.filter(({target}) => {
      if (normalizeTargetType(target.type) !== normalizeTargetType(current.type)) return false;
      if (["NEW_NIGHT_TARGET", "HANGUP"].includes(normalizeTargetType(current.type))) return true;
      const route = String(current.routeNumber || current.targetNumber || current.number || "");
      return Boolean(route && route === String(target.routeNumber || target.targetNumber || target.number || ""));
    }) : [];
    state.profileTargetValue = (matches.length === 1 ? matches[0].option.value : preferred?.option?.value) || "";
  }
  return state.profileTargetValue;
}

function daynightTargetOptionMarkup(option, selectedValue) {
  const key = option.kind === "HANGUP" ? "portal.hangUpEndCall_f2853" : option.kind === "NEW_NIGHT_TARGET" ? "portal.createNewNightTargetAnnouncementNextStep" : "";
  return `<option value="${escapeHtml(option.value)}" ${option.value === selectedValue ? "selected" : ""} ${key ? `data-i18n-key="${key}"` : "data-i18n-ignore data-portal-target-option"}>${escapeHtml(option.label)}</option>`;
}

function portalKeyedMessageMarkup(key, fallback, params = {}) {
  return `<span data-i18n-key="${escapeHtml(key)}" data-i18n-params="${escapeHtml(JSON.stringify(params))}">${escapeHtml(portalMessage(key, fallback, params))}</span>`;
}

function daynightGatewayStatusMarkup(entry) {
  if (!entry.gatewayExists) return portalKeyedMessageMarkup("portal.newTimeControlValue", "New · Time control {p0}", { p0: entry.gateway?.extensionNumber || "" });
  return portalKeyedMessageMarkup(entry.gatewayNeedsUpdate ? "portal.timeControlNeedsUpdate" : "portal.timeControlMatches", entry.gatewayNeedsUpdate ? "Update target · Time control {number}" : "matching · Time control {number}", { number: entry.gateway?.extensionNumber || "" });
}

function daynightBehaviorMarkup(entry) {
  if (entry.blockers?.length) return portalMessagesMarkup(entry.blockers, ", ");
  if (!entry.behaviorNote) return "";
  if (entry.currentTarget?.isUnassigned) return portalKeyedMessageMarkup("portal.server.theNumberIsUnassignedDuringTheDayWithinThe", "The number is unassigned during the day. Within the time-control window this becomes hang up; after restoration it remains without a target.");
  if (entry.currentTarget?.isFrontdesk) return portalKeyedMessageMarkup("portal.server.frontdeskNiaRemainsTheDayTargetBehindTheTime", "Frontdesk/Nia remains the day target behind the time control. The AI solution is unchanged; only the number would initially point to the time control before Frontdesk.");
  return portalKeyedMessageMarkup("portal.server.theOriginalTargetRemainsTheDayTargetBehindThe", "The original target remains the day target behind the time control.");
}

function gatewayTargetControlMarkup() {
  const choices = parsedDaynightTargetOptions();
  ensureProfileTargetValue(choices);
  const selected = selectedProfileTarget(choices);
  const createDialog = normalizeTargetType(selected?.type) === "NEW_NIGHT_TARGET";
  const announcements = daynightAnnouncementOptions();
  const selectedAnnouncement = selectedAnnouncementName();
  const afterValue = selectedAnnouncementAfterValue();
  const announcementSource = state.daynightAnnouncementSource || "existing";
  const displayName = daynightAnnouncementDisplayName(selectedAnnouncement);
  const announcementPlanReady = Boolean(state.daynightGatewayPreview?.type === "daynight-announcement-target" && state.daynightGatewayPreview?.ok);
  const canPlanAnnouncementTarget = Boolean(displayName.trim() && announcements.length && announcementSource === "existing" && !state.daynightAnnouncementLoading);
  const selectedTitle = selected ? displayTargetName(selected.type, selected.title) || targetTypeLabel(selected.type) : portalMessage("portal.noTargetSelected", "No target selected");
  return `
    <div class="daynight-target-card ${createDialog ? "is-new-target" : ""}">
      <div>
        <span>${escapeHtml(portalMessage("portal.nightRouting", "Night routing"))}</span>
        <strong ${!selected ? 'data-i18n-key="portal.noTargetSelected"' : createDialog ? 'data-i18n-key="portal.createNewNightTarget"' : normalizeTargetType(selected?.type) === "HANGUP" ? 'data-i18n-key="portal.hangUp"' : "data-i18n-ignore"}>${escapeHtml(selectedTitle)}</strong>
        <small>${escapeHtml(createDialog ? portalMessage("portal.createATargetFirstNightModeCanThenBe", "Create a target first. Night mode can then be planned and activated.") : portalMessage("portal.thisExistingTargetIsUsedForNightMode", "This existing target is used for night mode."))}</small>
      </div>
      <label class="profile-target-control"><span>${escapeHtml(portalMessage("portal.nightTarget", "Night target"))}</span>
        <span class="select-search-stack">
          <input class="select-filter-input" type="search" ${portalPlaceholderAttributes("portal.searchTarget_fc750", "Search target...")} ${portalSelectLabelAttributes("portal.searchNightTarget", "Search night target")}>
          <select id="daynight-gateway-target-select">
            <option value="" disabled ${state.profileTargetValue ? "" : "selected"}>${escapeHtml(portalMessage("portal.selectTarget", "Select target"))}</option>
            ${choices.map(({ option }) => daynightTargetOptionMarkup(option, state.profileTargetValue)).join("")}
          </select>
        </span>
      </label>
    </div>
    ${createDialog ? `
      <div class="daynight-announcement-card">
        <div>
          <span>${escapeHtml(portalMessage("portal.newNightTarget", "New night target"))}</span>
          <strong>${escapeHtml(portalMessage("portal.createNewVoiceDialog", "Create new voice dialog"))}</strong>
          <small>${escapeHtml(portalMessage("portal.theExistingAnnouncementIsLinkedWithoutModificationTheName", "The existing announcement is linked without modification. The name applies to the new voice dialog."))}</small>
        </div>
        <label class="profile-target-control"><span>${escapeHtml(portalMessage("portal.newVoiceDialogName", "New voice dialog name"))}</span>
          <input id="daynight-announcement-display-name" ${state.daynightAnnouncementDisplayNameEdited || state.daynightAnnouncementDisplayName ? `value="${escapeHtml(displayName)}"` : portalDefaultAttributes("portal.nightAnnouncementValue", "Night announcement {p0}", { p0: selectedAnnouncement || portalMessage("portal.announcement", "Announcement") })} ${portalPlaceholderAttributes("portal.eGNightAnnouncementReception", "e.g. Night announcement reception")}>
        </label>
        <div class="daynight-mode-toggle" role="group" aria-label="${escapeHtml(portalMessage("portal.announcementSource", "Announcement source"))}">
          <label>
            <input name="daynight-announcement-source" type="radio" value="existing" ${announcementSource === "existing" ? "checked" : ""}>
            <span>${escapeHtml(portalMessage("portal.existingAnnouncement", "Existing announcement"))}</span>
          </label>
          <label>
            <input name="daynight-announcement-source" type="radio" value="upload" ${announcementSource === "upload" ? "checked" : ""}>
            <span>${escapeHtml(portalMessage("portal.uploadMp3Wav", "Upload MP3/WAV"))}</span>
          </label>
        </div>
        ${announcementSource === "existing" ? `
          <label class="profile-target-control"><span>${escapeHtml(portalMessage("portal.announcement", "Announcement"))}</span>
            <span class="select-search-stack">
              <input class="select-filter-input" type="search" ${portalPlaceholderAttributes("portal.searchAnnouncement_f13ad", "Search announcement...")} ${portalSelectLabelAttributes("portal.searchAnnouncement", "Search announcement")}>
              <select id="daynight-announcement-select" ${announcements.length ? "" : "disabled"}>
                ${announcements.length ? announcements.map((announcement) => {
                  const value = announcement.name || announcement.value || announcement.id;
                  return `<option value="${escapeHtml(value)}" ${value === selectedAnnouncement ? "selected" : ""} data-i18n-ignore>${escapeHtml(value)}</option>`;
                }).join("") : `<option value="">${escapeHtml(portalMessage("portal.noAnnouncementFound", "No announcement found"))}</option>`}
              </select>
            </span>
          </label>
        ` : `
          <div class="announcement-upload-placeholder" aria-disabled="true">
            <span>${escapeHtml(portalMessage("portal.mp3WavFile", "MP3/WAV file"))}</span>
            <div class="upload-control is-disabled">
              <strong>${escapeHtml(portalMessage("portal.uploadPrepared", "Upload prepared"))}</strong>
              <small>${escapeHtml(portalMessage("portal.enabledAfterTheAudioTest", "Enabled after the audio test"))}</small>
              <input id="daynight-announcement-upload" type="file" accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav" disabled tabindex="-1" aria-hidden="true">
            </div>
            <small>${escapeHtml(portalMessage("portal.useAnExistingAnnouncementUntilThen", "Use an existing announcement until then."))}</small>
          </div>
        `}
        <label class="profile-target-control"><span>${escapeHtml(portalMessage("portal.next", "Next"))}</span>
          <span class="select-search-stack">
            <input class="select-filter-input" type="search" ${portalPlaceholderAttributes("portal.searchTarget_fc750", "Search target...")} ${portalSelectLabelAttributes("portal.searchTargetAfterAnnouncement", "Search target after announcement")}>
            <select id="daynight-announcement-after-select">
              ${daynightTargetOptions({ includeCreateOption: false }).map(option => daynightTargetOptionMarkup(option, afterValue)).join("")}
            </select>
          </span>
        </label>
        <div class="daynight-announcement-actions">
          <button class="secondary-button" id="plan-daynight-announcement-target" type="button" ${canPlanAnnouncementTarget ? "" : "disabled"}>${state.daynightAnnouncementLoading ? portalMessage("portal.checking", "Checking...") : portalMessage("portal.checkNewTarget", "Check new target")}</button>
          <button class="primary-button" id="apply-daynight-announcement-target" type="button" ${state.daynightAnnouncementLoading || !announcementPlanReady || !liveApplyPermitted() ? "disabled" : ""}>${escapeHtml(portalMessage("portal.createNewNightTarget_24c33", "Create new night target"))}</button>
        </div>
      </div>
    ` : ""}
  `;
}

function resetDaynightAnnouncementPlan() {
  if (state.daynightGatewayPreview?.type === "daynight-announcement-target") {
    state.daynightGatewayPreview = null;
  }
}

function daynightRequiresDialogCreation() {
  const selected = selectedProfileTarget(parsedDaynightTargetOptions());
  return normalizeTargetType(selected?.type) === "NEW_NIGHT_TARGET";
}

function profileAccountKey() {
  return getOverview()?.account || "demo";
}

function readProfile(name) {
  const profiles = readStoredProfiles();
  return profiles[profileAccountKey()]?.[name] || null;
}

function writeProfile(name, profile) {
  const profiles = readStoredProfiles();
  const account = profileAccountKey();
  profiles[account] = {
    ...(profiles[account] || {}),
    [name]: profile,
  };
  saveStoredProfiles(profiles);
}

function didTrunkHref(did) {
  return (getOverview()?.inventory?.trunks || [])
    .find((trunk) => trunk.name === did?.trunkNumber || trunk.value === did?.trunkNumber)?.id || "";
}

function targetFromDid(did) {
  const type = did?.destinationType || "PHONEEXTENSION";
  const routeNumber = normalizeTargetType(type) === "QUEUE"
    ? did?.destinationServiceNumber || did?.destinationExtension || ""
    : did?.destinationServiceNumber || did?.destinationExtension || "";
  return {
    type,
    title: did?.destinationName || did?.value || "",
    subtitle: did?.destinationExtension ? `${targetTypeLabel(type)} ${did.destinationExtension}` : targetTypeLabel(type),
    number: did?.destinationExtension || "",
    targetNumber: did?.destinationExtension || "",
    routeNumber,
    tone: targetTone(type),
    ...serviceMetaForTarget(type, routeNumber, did?.destinationExtension, did?.destinationName || did?.value),
  };
}

function normalizeTargetType(type) {
  const value = String(type || "").toUpperCase();
  if (value === "PHONE") return "PHONEEXTENSION";
  if (value === "ZEITREGEL") return "TIMECONTROL";
  if (value === "SPRACHDIALOG") return "IVR";
  if (value === "FALLBACK") return "HANGUP";
  return value;
}

function targetCompareKey(target) {
  const type = normalizeTargetType(target?.type);
  let href = String(target?.href || "");
  if (href) {
    try { href = new URL(href, window.location.origin || "http://localhost").pathname.replace(/\/+$/, ""); } catch { /* Keep non-URL identifiers literal. */ }
    return `${type}:href:${href.toLowerCase()}`;
  }
  const number = [target?.routeNumber, target?.number, target?.targetNumber].find(value => value != null && String(value).trim() !== "");
  return `${type}:${number == null ? "" : String(number).trim().toLowerCase()}`;
}

function sameTargetIdentity(left, right) {
  if (normalizeTargetType(left?.type) !== normalizeTargetType(right?.type)) return false;
  if (left?.href && right?.href) return targetCompareKey(left) === targetCompareKey(right);
  // Applied flows include hrefs that inventory options may omit. Compare the
  // typed provider route only when an explicit href is missing on either side.
  const leftKey = targetCompareKey({ ...left, href: "" });
  const rightKey = targetCompareKey({ ...right, href: "" });
  return leftKey !== `${normalizeTargetType(left?.type)}:` && leftKey === rightKey;
}

function filterSearchableSelect(input, { preserveSelection = false } = {}) {
  const stack = input.closest(".select-search-stack");
  const select = stack?.querySelector("select");
  if (!select) return;
  const query = input.value.trim().toLocaleLowerCase(portalLocale());
  let firstMatch = null;
  Array.from(select.options).forEach((option) => {
    const keep = !query || !option.value || option.textContent.toLocaleLowerCase(portalLocale()).includes(query);
    option.hidden = !keep;
    option.disabled = Boolean(query && option.value && !keep);
    if (query && keep && option.value && !firstMatch) {
      firstMatch = option;
    }
  });
  if (!preserveSelection && query && firstMatch && select.value !== firstMatch.value) {
    select.value = firstMatch.value;
    syncSearchableSelectState(select);
  }
}

function syncSearchableSelectState(select) {
  if (select.id === "daynight-gateway-target-select") {
    state.profileTargetValue = select.value;
    state.daynightGatewayPreview = null;
    state.daynightOperationFeedback = null;
    return;
  }
  if (select.id === "daynight-announcement-select") {
    state.daynightAnnouncementName = select.value;
    resetDaynightAnnouncementPlan();
    $("#apply-daynight-announcement-target")?.setAttribute("disabled", "");
    return;
  }
  if (select.id === "daynight-announcement-after-select") {
    state.daynightAnnouncementAfterValue = select.value;
    resetDaynightAnnouncementPlan();
    $("#apply-daynight-announcement-target")?.setAttribute("disabled", "");
  }
}

function didHasTarget(did, target) {
  return targetCompareKey(targetFromDid(did)) === targetCompareKey(target);
}

function applyPayloadForDid(did, target) {
  return {
    did: {
      id: did?.id || "",
      name: did?.name || "",
      href: did?.href || "",
      trunkHref: didTrunkHref(did),
      didExtension: did?.didExtension || "",
      destinationName: did?.destinationName || did?.value || "",
      destinationType: did?.destinationType || "",
      destinationExtension: did?.destinationExtension || "",
      destinationServiceNumber: did?.destinationServiceNumber || "",
    },
    target: {
      type: target?.type || "",
      title: target?.title || "",
      subtitle: target?.subtitle || "",
      number: target?.number || target?.targetNumber || targetNumberFromText(target?.subtitle),
      routeNumber: target?.routeNumber || "",
      href: target?.href || "",
    },
  };
}

function buildProfileSnapshot(name) {
  const dids = getOverview()?.inventory?.dids || [];
  return {
    name,
    account: profileAccountKey(),
    createdAt: new Date().toISOString(),
    dids: dids.map((did) => ({
      id: did.id,
      name: did.name,
      target: targetFromDid(did),
    })),
  };
}

function buildChangesToTarget(target) {
  return (getOverview()?.inventory?.dids || [])
    .filter((did) => !didHasTarget(did, target))
    .map((did) => applyPayloadForDid(did, target));
}

function buildChangesFromProfile(profile) {
  const liveDids = getOverview()?.inventory?.dids || [];
  return (profile?.dids || [])
    .map((snapshot) => {
      const did = liveDids.find((item) => item.id === snapshot.id || item.name === snapshot.name);
      if (!did || didHasTarget(did, snapshot.target)) return null;
      return applyPayloadForDid(did, snapshot.target);
    })
    .filter(Boolean);
}

function formatProfileTime(profile) {
  if (!profile?.createdAt) return portalMessage("portal.notSaved", "Not saved");
  return formatTime(profile.createdAt);
}

function validateFlow() {
  return validateFlowDetails().checks;
}

function validTimeWindow(value) {
  const match = String(value || "").trim().match(/^([A-Za-zÄÖÜäöü]+)(?:\s*-\s*([A-Za-zÄÖÜäöü]+))?\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  const days = new Set("MON MONDAY TUE TUESDAY WED WEDNESDAY THU THURSDAY FRI FRIDAY SAT SATURDAY SUN SUNDAY".split(" "));
  return Boolean(match && days.has(match[1].toUpperCase()) && days.has((match[2] || match[1]).toUpperCase()) && Number(match[3]) < 24 && Number(match[4]) < 60 && Number(match[5]) < 24 && Number(match[6]) < 60);
}

function validateFlowDetails() {
  if (state.flow?.providerConflict) {
    const message = portalMessage("portal.error.flowProviderChanged", "Provider routing changed. The local draft is preserved. Delete the local draft to load the current routing.");
    return { ok: false, liveCapable: false, complex: false, ambiguous: true, checks: [], problems: [message] };
  }
  const routingProblems = flowRoutingConflicts(state.flow).map(flowRoutingConflictMessage);
  if (routingProblems.length) return { ok: false, liveCapable: false, complex: flowHasComplexNodes(), ambiguous: true, checks: routingProblems, problems: routingProblems };
  const did = selectedDid();
  if (state.flow) {
    pruneDisconnectedFlowNodes(state.flow);
    materializeBranchNodes(state.flow);
  }
  const nodes = state.flow?.nodes || [];
  const complex = flowHasComplexNodes();
  // Validate the connected route used by preview/apply, independently of canvas selection.
  const target = flowStartNode();
  const checks = [];
  const problems = [];
  if (did) checks.push(portalMessage("portal.numberSelected", "Number selected"));
  else problems.push(portalMessage("portal.numberMissing", "Number missing"));

  if (complex) {
    if (target?.title) checks.push(portalMessage("portal.startingStepSet", "Starting step set"));
    else problems.push(portalMessage("portal.startingStepMissing", "Starting step missing"));
  } else if (target?.title) {
    checks.push(portalMessage("portal.targetSet", "Target set"));
  } else {
    problems.push(portalMessage("portal.targetMissing", "Target missing"));
  }

  for (const node of nodes) {
    if (node.locked) continue;
    ensureNodeConfig(node);
    const kind = normalizeTargetType(node.type);
    if (kind === "TIMECONTROL") {
      if (!node.config.portalMode) {
        problems.push(portalMessage("portal.chooseNewOrExistingForTheTimeControl", "Choose new or existing for the time control"));
      } else if (node.config.portalMode === "existing") {
        if (node.routeNumber || node.targetNumber) checks.push(portalMessage("portal.existingTimeControlSelected", "Existing time control selected"));
        else problems.push(portalMessage("portal.existingTimeControlMissing", "Existing time control missing"));
      } else {
        if (validTimeWindow(node.config.hours)) checks.push(portalMessage("portal.timeControlHasATimeWindow", "Time control has a time window"));
        else problems.push(portalMessage("portal.error.dayFormat", "Use English day names, for example Mon-Fri 08:00-17:00."));
        if (!isMissingFlowNode(branchTargetNode(node, "openTarget"))) checks.push(portalMessage("portal.timeControlTargetInsideOpeningHours", "Time control: target inside opening hours"));
        else problems.push(portalMessage("portal.timeControlRequiresATargetInsideOpeningHours", "Time control requires a target inside opening hours"));
        if (!isMissingFlowNode(branchTargetNode(node, "closedTarget")) || node.config.announcement) checks.push(portalMessage("portal.timeControlTargetOutsideOpeningHours", "Time control: target outside opening hours"));
        else problems.push(portalMessage("portal.timeControlRequiresATargetOrAnnouncementOutsideOpening", "Time control requires a target or announcement outside opening hours"));
      }
    }
    if (kind === "IVR") {
      if (!node.config.portalMode) {
        problems.push(portalMessage("portal.chooseNewOrExistingForTheVoiceDialog", "Choose new or existing for the voice dialog"));
      } else if (node.config.portalMode === "existing") {
        if (node.routeNumber || node.targetNumber) checks.push(portalMessage("portal.existingVoiceDialogSelected", "Existing voice dialog selected"));
        else problems.push(portalMessage("portal.existingVoiceDialogMissing", "Existing voice dialog missing"));
      } else {
        if (node.config.announcement) checks.push(portalMessage("portal.voiceDialogHasAnAnnouncement", "Voice dialog has an announcement"));
        else problems.push(portalMessage("portal.voiceDialogRequiresAnAnnouncement", "Voice dialog requires an announcement"));
        if (ivrKeyNumbers(node).some((key) => !isMissingFlowNode(branchTargetNode(node, ivrTargetField(key))))) checks.push(portalMessage("portal.voiceDialogHasAKeyTarget", "Voice dialog has a key target"));
        else problems.push(portalMessage("portal.voiceDialogRequiresAtLeastOneKeyTarget", "Voice dialog requires at least one key target"));
        if (!isMissingFlowNode(branchTargetNode(node, "timeoutTarget"))) checks.push(portalMessage("portal.voiceDialogHasATimeoutTarget", "Voice dialog has a timeout target"));
        else problems.push(portalMessage("portal.voiceDialogRequiresATimeoutTarget", "Voice dialog requires a timeout target"));
      }
    }
    if (["QUEUE", "GROUP", "SKILL"].includes(kind)) {
      if (!node.config.portalMode) {
        problems.push(portalMessage("portal.chooseNewOrExistingForValue", "Choose new or existing for {p0}", { p0: readableNodeType(kind) }));
      } else if (node.config.portalMode === "existing" && !(node.routeNumber || node.targetNumber)) {
        problems.push(portalMessage("portal.existingValueMissing", "Existing {p0} missing", { p0: readableNodeType(kind) }));
      }
    }
    if (kind === "ANNOUNCEMENT") {
      problems.push(portalMessage("portal.server.announcementsAreMediaInThePortalApiAndCannot", "Announcements are media in the Portal API and cannot be used as standalone routing targets. Use them in a voice dialog or queue."));
    }
    if (kind === "QUEUE" && node.config.timeoutSeconds) {
      checks.push(portalMessage("portal.queueTimeoutValues", "Queue timeout {p0}s", { p0: node.config.timeoutSeconds }));
      if (!isMissingFlowNode(branchTargetNode(node, "timeoutTarget"))) checks.push(portalMessage("portal.queueHasATimeoutTarget", "Queue has a timeout target"));
      else problems.push(portalMessage("portal.queueRequiresATargetAfterTimeout", "Queue requires a target after timeout"));
    }
    if (kind === "PLACEHOLDER") {
      problems.push(portalMessage("portal.openPathRequiresAStep", "Open path requires a step"));
    }
  }

  const targetReady = Boolean(target?.title && (target?.routeNumber || target?.targetNumber || target?.type === "HANGUP"));
  const routedNodeIds = reachableFlowNodeIds(state.flow);
  const unsupportedStep = nodes.some(node => routedNodeIds.has(node.id) && normalizeTargetType(node.type) === "ANNOUNCEMENT");
  const liveCapable = !unsupportedStep && Boolean(did && target) && (complex || targetReady);
  if (problems.length) checks.push(...problems);
  else checks.push(liveCapable ? (complex ? portalMessage("portal.portalObjectsCanBeCreatedLive", "Portal objects can be created live") : portalMessage("portal.readyToApplyLive", "Ready to apply live")) : portalMessage("portal.completeDraft", "Complete draft"));

  return {
    ok: problems.length === 0,
    checks,
    problems,
    complex,
    liveCapable,
  };
}

function flowHasComplexNodes() {
  return (state.flow?.nodes || []).some((node) => {
    if (node.locked || node.isTarget) return false;
    const kind = normalizeTargetType(node.type);
    if (["QUEUE", "GROUP", "SKILL"].includes(kind)) return Boolean(node.config?.portalMode || node.config?.timeoutSeconds || node.config?.timeoutTarget);
    return ["TIMECONTROL", "IVR", "ANNOUNCEMENT", "HANGUP", "PLACEHOLDER"].includes(kind);
  });
}

function renderChangeAssistant() {
  const target = $("#change-assistant");
  if (!target) return;
  target.innerHTML = `
    <div class="empty-state">${escapeHtml(portalMessage("portal.extensionActionsAreNowInTheExtensionsSection", "Extension actions are now in the Extensions section."))}</div>
  `;
}

function extensionActionMarkup() {
  const extension = selectedExtension();
  const nextNumber = nextExtensionNumber(extension);
  const mode = state.extensionActionMode === "create" ? "create" : "clone";
  const cloneForm = `
    <form class="action-form" id="clone-form">
      <label>Vorlage
        <input value="${escapeHtml(extension ? `${extension.number} ${extension.name}` : portalMessage("portal.noSelection", "No selection"))}" disabled>
      </label>
      <label>Neue Nummer
        <input name="extensionNumber" value="${escapeHtml(nextNumber)}" required>
      </label>
      <label>Name
        <input name="displayName" ${extension ? portalDefaultAttributes("portal.valueCopy", "{p0} copy", { p0: extension.name }) : portalDefaultAttributes("portal.newExtension", "New extension")} required>
      </label>
      <button class="primary-button" type="submit">${escapeHtml(portalMessage("portal.prepareCopy", "Prepare copy"))}</button>
    </form>
  `;
  const createForm = `
    <form class="action-form" id="create-form">
      <label>Nummer
        <input name="extensionNumber" value="299" required>
      </label>
      <label>Name
        <input name="displayName" ${portalDefaultAttributes("portal.newExtension", "New extension")} required>
      </label>
      <button class="secondary-button" type="submit">${escapeHtml(portalMessage("portal.prepareNewExtension", "Prepare new extension"))}</button>
    </form>
  `;
  return `
    <div class="extension-action-layout">
      <button class="extension-action-choice ${mode === "clone" ? "is-active" : ""}" type="button" data-extension-action-mode="clone">
        <strong>${escapeHtml(portalMessage("portal.copySetup", "Copy setup"))}</strong>
        <span>${escapeHtml(portalMessage("portal.prepareACopyOfTheSelectedExtension", "Prepare a copy of the selected extension."))}</span>
      </button>

      <button class="extension-action-choice ${mode === "create" ? "is-active" : ""}" type="button" data-extension-action-mode="create">
        <strong>${escapeHtml(portalMessage("portal.newExtension", "New extension"))}</strong>
        <span>${escapeHtml(portalMessage("portal.prepareANewExtension", "Prepare a new extension."))}</span>
      </button>

      <section class="assistant-card extension-action-editor">
        <h3>${mode === "clone" ? portalMessage("portal.copySetup", "Copy setup") : portalMessage("portal.newExtension", "New extension")}</h3>
        <p>${mode === "clone" ? portalMessage("portal.preparesACopyOfTheSelectedExtensionNothingIs", "Prepares a copy of the selected extension. Nothing is saved to the Portal.") : portalMessage("portal.preparesANewExtensionNothingIsSavedToThe", "Prepares a new extension. Nothing is saved to the Portal.")}</p>
        ${mode === "clone" ? cloneForm : createForm}
      </section>
    </div>
  `;
}

function renderActionPlan() {
  const setupPlan = $("#action-plan");
  const showSetupPlan = Boolean(state.actionPlan?.type === "profile" && state.actionPlan.context === "changes");
  if (setupPlan) setupPlan.hidden = !showSetupPlan;
  const extensionPlanCard = $("#extension-action-plan-card");
  const showExtensionPlan = Boolean(state.actionPlan && state.actionPlan.context === "extensions");
  if (extensionPlanCard) {
    extensionPlanCard.hidden = !showExtensionPlan;
  }
  const targets = [showSetupPlan ? "#action-plan" : "", showExtensionPlan ? "#extension-action-plan" : ""]
    .filter(Boolean)
    .map((selector) => $(selector))
    .filter(Boolean);
  if (!targets.length) return;
  if (!state.actionPlan) {
    targets.forEach((target) => {
      target.innerHTML = `<div class="empty-state">${escapeHtml(portalMessage("portal.noPreparedChange", "No prepared change."))}</div>`;
    });
    return;
  }

  const body = state.actionPlan.body || {};
  const isFlowPlan = Boolean(state.actionPlan.flow);
  const isProfilePlan = state.actionPlan.type === "profile";
  const isPhonebookPlan = state.actionPlan.type === "phonebook-sync";
  const hasApplyPayload = Boolean(state.actionPlan.applyPayload);
  const canApplyFlow = isFlowPlan && hasApplyPayload && !state.actionPlan.applied && localApplyPermitted();
  const canApplyProfile = isProfilePlan
    && state.actionPlan.applyPayload?.changes?.length
    && !state.actionPlan.applied
    && state.actionPlan.ok !== false
    && liveApplyPermitted();
  const checklist = isPhonebookPlan
    ? [
      portalMessage("portal.sourceValueContactsValuePhoneNumbers", "Source: {p0} contacts / {p1} phone numbers", { p0: state.actionPlan.source?.googleContacts ?? 0, p1: state.actionPlan.source?.googlePhones ?? 0 }),
      portalMessage("portal.nfonValuePhonebookEntriesInValue", "NFON: {p0} phonebook entries in {p1}", { p0: state.actionPlan.target?.portalEntries ?? 0, p1: state.actionPlan.target?.phoneBook || portalMessage("portal.phonebook", "Phonebook") }),
      portalMessage("portal.differenceValueNewValueUpdatedValueUnchanged", "Difference: {p0} new, {p1} updated, {p2} unchanged", { p0: state.actionPlan.summary?.create ?? 0, p1: state.actionPlan.summary?.update ?? 0, p2: state.actionPlan.summary?.unchanged ?? 0 }),
      state.actionPlan.applied ? portalMessage("portal.changesWereSentToThePortalApi", "Changes were sent to the Portal API.") : portalMessage("portal.applyChangesDirectlyInPhonebookSync", "Apply changes directly in phonebook sync."),
    ]
    : isProfilePlan
    ? [
      portalMessage("portal.checkValueNumbers", "Check {p0} numbers.", { p0: state.actionPlan.changeCount || 0, p1: state.actionPlan.changeCount === 1 ? "" : "n" }),
      ...(state.actionPlan.changes || []).slice(0, 4).map((change) => `${change.before || "-"} / ${change.after || "-"}`),
      state.actionPlan.applied ? portalMessage("portal.theProfileWasSentToTheLivePortalApi", "The profile was sent to the live Portal API.") : portalMessage("portal.liveChangesRequireConfirmation", "Live changes require confirmation."),
    ]
    : isFlowPlan
    ? [
      portalMessage("portal.checkCallflowForValue", "Check callflow for {p0}.", { p0: state.actionPlan.did || portalMessage("portal.theSelectedNumber", "the selected number") }),
      portalMessage("portal.beforeValue", "Before: {p0}", { p0: state.actionPlan.before || "-" }),
      portalMessage("portal.draftValue", "Draft: {p0}", { p0: state.actionPlan.after || "-" }),
      STATIC_DEMO_MODE ? portalMessage(state.actionPlan.applied ? "portal.demo.changeSaved" : "portal.demo.localApplyAvailable", "") : state.actionPlan.applied ? portalMessage("portal.theChangeWasSentToTheLivePortalApi", "The change was sent to the live Portal API.") : portalMessage("portal.liveChangesRequireConfirmation", "Live changes require confirmation."),
    ]
    : [
      portalMessage("portal.prepareExtensionValueNamedValue", "Prepare extension {p0} named {p1}.", { p0: body.extensionNumber || portalMessage("portal.new_b1688", "new"), p1: body.displayName || "-" }),
      portalMessage("portal.checkDevicesNumbersAndCallflowBeforeSavingLive", "Check devices, numbers and callflow before saving live."),
      portalMessage("portal.liveChangesRequireSeparateApproval", "Live changes require separate approval."),
    ];
  const statusLabel = state.actionPlan.ok === false
    ? portalMessage("portal.error", "Error")
    : state.actionPlan.blocked
      ? portalMessage("portal.server.notice", "Notice")
    : state.actionPlan.applied
      ? (STATIC_DEMO_MODE ? portalMessage("portal.demo.localWriteNotice", "Demo PBX: changes are saved locally.") : portalMessage("portal.appliedLive", "Applied live"))
      : portalMessage("portal.check_9a90a", "check");
  const html = `
    <div class="plan-summary">
      <span class="pill ${state.actionPlan.ok === false ? "is-error" : state.actionPlan.blocked ? "is-warning" : ""}">${escapeHtml(statusLabel)}</span>
      <strong>${escapeHtml(state.actionPlan.title || portalMessage("portal.changePrepared", "Change prepared"))}</strong>
      <span>${escapeHtml(state.actionPlan.message || portalMessage("portal.nothingWasSavedInThePortal", "Nothing was saved in the Portal."))}</span>
      <ol class="check-list">
        ${checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ol>
      ${canApplyFlow ? `<button class="primary-button" id="apply-flow-live" type="button">${STATIC_DEMO_MODE ? portalMessage("portal.demo.applyFlowLocally", "Apply flow locally") : portalMessage("portal.applyFlowLive", "Apply flow live")}</button>` : ""}
      ${canApplyProfile ? `<button class="primary-button" id="apply-profile-live" type="button">${escapeHtml(portalMessage("portal.applyProfileLive", "Apply profile live"))}</button>` : ""}
      ${((hasApplyPayload || isPhonebookPlan) && !localApplyPermitted() && !canApplyFlow && !state.actionPlan.applied) ? `<span class="plan-note">${escapeHtml(liveWritesDisabledText())}</span>` : ""}
      ${isPhonebookPlan ? `
        <div class="sync-action-preview">
          ${(state.actionPlan.actions || []).slice(0, 8).map((action) => `
            <div class="sync-action-row">
              <span>${escapeHtml(action.action === "create-phonebook" ? portalMessage("portal.phonebook", "Phonebook") : action.action === "create" ? portalMessage("portal.create", "Create") : portalMessage("portal.refresh", "Refresh"))}</span>
              <strong data-i18n-ignore>${escapeHtml(action.contact || "-")}</strong>
              <small data-i18n-ignore>${escapeHtml(action.phone || "")}</small>
            </div>
          `).join("") || `<div class="empty-state is-compact">${escapeHtml(portalMessage("portal.noPhonebookChangeNeeded", "No phonebook change needed."))}</div>`}
        </div>
      ` : ""}
      <details>
        <summary>${escapeHtml(portalMessage("portal.technicalDetails", "Technical details"))}</summary>
        <pre>${escapeHtml(JSON.stringify(state.actionPlan, null, 2))}</pre>
      </details>
    </div>
  `;
  targets.forEach((target) => {
    target.innerHTML = html;
  });
}

function flowAvailability() {
  if (state.loading) return { kind: "loading", ok: false, message: portalMessage("portal.loading", "Loading") };
  const overview = getOverview();
  if (state.error || !overview || overview.endpoints?.dids?.ok === false || overview.connection?.state === "unavailable") return { kind: "error", ok: false, message: `${portalMessage("portal.loadingFailed", "Loading failed")}. ${portalMessage("portal.inventoryUnavailable", "Data could not be loaded.")}` };
  if (overview.connection?.authenticationRequired) return { kind: "error", ok: false, message: portalMessage("portal.loginRequired", "Sign in required") };
  if (!(getOverview()?.inventory?.dids || []).length) return { kind: "empty", ok: false, message: portalMessage("portal.noNumbersFound", "No numbers found.") };
  return null;
}

function fitFlowDidMenu() {
  const menu = $("#flow-did-menu");
  if (!menu || menu.hidden) return;
  const viewport = window.visualViewport;
  let bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
  for (let ancestor = menu.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (!/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(ancestor).overflowY)) continue;
    const rect = ancestor.getBoundingClientRect();
    bottom = Math.min(bottom, rect.top + ancestor.clientTop + ancestor.clientHeight);
  }
  const available = Math.floor(bottom - menu.getBoundingClientRect().top - 8);
  menu.style.maxHeight = `${Math.max(0, Math.min(360, available))}px`;
}

function renderFlowFeedback() {
  const feedback = $("#flow-feedback");
  if (!feedback) return;
  localizeResponseMessages(state.flowFeedback);
  const plan = state.view === "callflow" && state.actionPlan?.context === "callflow" ? state.actionPlan : null;
  const complexSaved = Boolean(plan?.flow && !plan.applyPayload && plan.ok !== false);
  const hasLocalDraft = Boolean(state.flow?.draftUpdatedAt) && (!plan || state.flow?.providerConflict);
  const selected = selectedDid();
  const availability = flowAvailability();
  const message = state.flow?.providerConflict ? { ok: false, title: selectedDidHeadline(selected),
    message: portalMessage("portal.error.flowProviderChanged", "Provider routing changed. The local draft is preserved. Delete the local draft to load the current routing.") } : availability ? { ...availability, title: selectedDidHeadline(selected) } : plan
    ? {
      ok: plan.ok !== false,
      title: selectedDidHeadline(selected),
      message: plan.message || "",
    }
    : state.flowFeedback || {
      ok: true,
      title: selectedDidHeadline(selected),
      message: state.flow?.draftUpdatedAt
        ? portalMessage("portal.localDraftLoadedValue", "Local draft loaded ({p0}).", { p0: formatTime(state.flow.draftUpdatedAt) })
        : state.flow?.appliedSnapshotAt
          ? (STATIC_DEMO_MODE ? portalMessage("portal.demo.localFlowLoaded", "Locally applied callflow loaded ({p0}).", { p0: formatTime(state.flow.appliedSnapshotAt) }) : portalMessage("portal.liveChangeLoadedValueTheDetailedStructureComesFrom", "Live change loaded ({p0}). The detailed structure comes from the applied flow.", { p0: formatTime(state.flow.appliedSnapshotAt) }))
        : portalMessage("portal.liveStateLoadedChangesRemainLocalUntilReview", "Live state loaded. Changes remain local until review."),
    };
  feedback.className = `flow-feedback ${availability && availability.kind !== "error" ? `is-${availability.kind}` : message.ok ? "is-ok" : "is-error"}`;
  feedback.innerHTML = `
    <div class="flow-feedback-copy">
      <button class="flow-did-selector" id="flow-did-selector" type="button" aria-expanded="false">
        <strong data-i18n-ignore>${escapeHtml(message.title)}</strong>
        <span aria-hidden="true">⌄</span>
      </button>
      <span>${escapeHtml(message.message || "")}</span>
      <div class="flow-did-menu" id="flow-did-menu" hidden>
        ${(getOverview()?.inventory?.dids || []).map((did) => `
          <button class="flow-did-option ${did.id === state.selectedDidId ? "is-selected" : ""}" type="button" data-did-id="${escapeHtml(did.id)}">
            <strong data-i18n-ignore>${escapeHtml(did.name || did.value || portalMessage("portal.number_b7905", "Number"))}</strong>
            <span ${(did.value || did.destinationName) ? 'data-i18n-ignore' : 'data-i18n-key="portal.noTargetDetected"'}>${escapeHtml(did.value || did.destinationName || portalMessage("portal.noTargetDetected", "No target detected"))}</span>
          </button>
        `).join("")}
      </div>
    </div>
    ${complexSaved ? `<span class="pill">${escapeHtml(portalMessage("portal.savedLocally", "Saved locally"))}</span>` : ""}
    ${complexSaved ? `<button class="secondary-button is-compact" id="save-flow-draft-from-plan" type="button">${escapeHtml(portalMessage("portal.saveAgain", "Save again"))}</button>` : ""}
    ${state.flow?.previousDraft ? `<button class="secondary-button is-compact" id="restore-previous-flow-draft" type="button">${escapeHtml(portalMessage("portal.restorePreviousDraft", "Restore previous draft"))}</button>` : ""}
  `;
  const clearDraftButton = $("#clear-flow-draft");
  if (clearDraftButton) clearDraftButton.hidden = !hasLocalDraft;
}

function selectedDidHeadline(did = selectedDid()) {
  if (!did) return portalMessage("portal.noNumberSelected", "No number selected");
  return did.name || did.value || portalMessage("portal.number_b7905", "Number");
}

function renderFlowProfileActions() {
  const target = $(".flow-profile-actions");
  if (!target) return;
  const choices = parsedDaynightTargetOptions();
  ensureProfileTargetValue(choices);
  const standardProfile = readProfile("standard");
  target.innerHTML = `
    <button class="secondary-button" id="save-standard-flow-profile" type="button">${escapeHtml(portalMessage("portal.saveDefault", "Save default"))}</button>
    <button class="secondary-button" id="stage-standard-flow-profile" type="button">${escapeHtml(portalMessage("portal.restoreDefault", "Restore default"))}</button>
    <input id="standard-flow-import-file" type="file" accept=".json,application/json" hidden>
  `;
  const summary = $("#daynight-summary");
  if (summary) {
    const overview = getOverview();
    const endpoint = overview?.endpoints?.timeControls;
    const didCount = overview?.inventory?.dids?.length || 0;
    const target = selectedProfileTarget();
    const readiness = [
      {
        label: portalMessage("portal.timeControls", "Time controls"),
        ok: endpoint?.ok || (overview?.inventory?.timeControls || []).length > 0,
        detail: endpoint?.ok
          ? portalMessage("portal.valueLoaded", "{p0} loaded", { p0: overview?.counts?.timeControls || 0 })
          : endpoint?.error || portalMessage("portal.notLoaded", "not loaded"),
      },
      {
        label: portalMessage("portal.nightTarget", "Night target"),
        ok: Boolean(target),
        detail: target ? `${displayTargetName(target.type, target.title) || target.type} ${target.routeNumber || target.targetNumber || ""}`.trim() : portalMessage("portal.noTargetSelected", "No target selected"),
      },
      {
        label: portalMessage("portal.defaultProfile", "Default profile"),
        ok: Boolean(standardProfile),
        detail: standardProfile ? portalMessage("portal.savedValue", "Saved {p0}", { p0: formatProfileTime(standardProfile) }) : portalMessage("portal.notSavedYet", "not saved yet"),
      },
      {
        label: portalMessage("portal.numbers", "Numbers"),
        ok: didCount > 0,
        detail: portalMessage("portal.valueNumbersAvailable", "{p0} numbers available", { p0: didCount, p1: didCount === 1 ? "" : "n" }),
      },
    ];
    const statusTitle = standardProfile ? portalMessage("portal.server.defaultProfileSaved", "Default profile saved") : portalMessage("portal.defaultProfileMissing", "Default profile missing");
    const statusDetail = standardProfile
      ? portalMessage("portal.nightModeCanBeCheckedAndLaterRestoredTo", "Night mode can be checked and later restored to the default.")
      : portalMessage("portal.saveTheCurrentStateAsTheDefaultFirst", "Save the current state as the default first.");
    summary.innerHTML = `
      <div class="daynight-summary-item ${standardProfile ? "" : "is-muted"}">
        <strong>${escapeHtml(statusTitle)}</strong>
        <span>${escapeHtml(statusDetail)}</span>
      </div>
      <div class="readiness-list daynight-readiness-list">
        ${readiness.map((item) => `
          <div class="readiness-item daynight-readiness-item ${item.ok ? "is-ok" : "is-warning"}">
            <strong>${escapeHtml(item.label)}</strong>
            <span>${escapeHtml(item.detail)}</span>
          </div>
        `).join("")}
      </div>
    `;
  }
  updateDaynightHeaderButton();
}

function daynightActivationReady() {
  const preview = state.daynightGatewayPreview;
  const summary = preview?.summary || {};
  return Boolean(
    preview?.ok
      && isCurrentWriteContext(preview.writeContext)
      && summary.total > 0
      && summary.gatewaysExisting === summary.total
      && !summary.gatewaysToUpdate
      && !daynightRequiresDialogCreation()
  );
}

function updateDaynightHeaderButton() {
  const switchLabel = $("#daynight-mode-switch");
  const toggle = $("#daynight-mode-toggle");
  const text = $("#daynight-mode-label");
  if (!switchLabel || !toggle || !text) return;
  switchLabel.hidden = false;
  switchLabel.classList.toggle("is-night-active", state.daynightActive);
  switchLabel.classList.toggle("is-loading", state.daynightModeSwitchLoading);
  toggle.checked = state.daynightActive;
  toggle.disabled = state.daynightSetupLoading || state.daynightModeSwitchLoading || state.daynightGatewayRoutingLoading || state.daynightGatewayResetLoading;
  text.textContent = state.daynightModeSwitchLoading ? portalMessage("portal.server.pleaseWait_ea36c", "Please wait...") : state.daynightActive ? portalMessage("portal.nightModeActive", "☾ Night mode active") : portalMessage("portal.dayMode", "☀ Day mode");
  const title = state.daynightActive
    ? portalMessage("portal.restoreDayMode", "Restore day mode")
    : portalMessage("portal.activateNightMode_5e185", "Activate night mode");
  switchLabel.title = title;
  toggle.setAttribute("aria-label", title);
}

function daynightSetupPermitted() {
  const settings = getOverview()?.settings;
  return !STATIC_DEMO_MODE && Boolean(settings?.configured && settings.liveWritesPermitted && !settings.liveWritesLocked);
}

function daynightSetupActionMarkup() {
  const busy = state.daynightSetupLoading || state.daynightGatewayLoading || state.daynightGatewayApplyLoading || state.daynightGatewayRoutingLoading || state.daynightGatewayResetLoading;
  return `<div class="daynight-action-row">
    <button class="primary-button" id="prepare-and-activate-night-mode" type="button" ${busy || state.daynightActive || !daynightSetupPermitted() ? "disabled" : ""}>${escapeHtml(portalMessage(state.daynightSetupLoading ? "portal.settingUpNightMode" : "portal.setUpAndActivateNightMode", "Set up and activate night mode"))}</button>
  </div>`;
}

function renderDaynightGatewayPreview() {
  const target = $("#daynight-gateway-preview");
  if (!target) return;
  const preview = state.daynightGatewayPreview;
  const requiresDialogCreation = daynightRequiresDialogCreation();
  if (!preview) {
    target.innerHTML = `
      <section class="daynight-preview-card is-muted">
        ${gatewayTargetControlMarkup()}
        <div>
          <span>${escapeHtml(portalMessage("portal.nightSetupDescription", "Save day routing, prepare time controls and activate night mode."))}</span>
        </div>
        ${daynightSetupActionMarkup()}
        <details><summary>${escapeHtml(portalMessage("portal.daynightAdvanced", "Details and maintenance"))}</summary>
        <div class="daynight-action-row">
          <button class="secondary-button" id="preview-daynight-gateway" type="button" ${state.daynightGatewayLoading || requiresDialogCreation ? "disabled" : ""}>${state.daynightGatewayLoading ? portalMessage("portal.checking", "Checking...") : portalMessage("portal.checkTimeControlPlan", "Check time-control plan")}</button>
        </div>
        </details>
      </section>
    `;
    updateDaynightHeaderButton();
    return;
  }
  if (preview.type === "daynight-announcement-target") {
    target.innerHTML = `
      <section class="daynight-preview-card">
        <div class="daynight-preview-header">
          <div>
            <h3 data-i18n-ignore>${escapeHtml(preview.title || portalMessage("portal.newNightTargetChecked", "New night target checked"))}</h3>
            <p>${escapeHtml(preview.message || "")}</p>
          </div>
          <span class="batch-status-pill ${preview.ok ? "is-ok" : "is-warning"}">Plan</span>
        </div>
        ${gatewayTargetControlMarkup()}
        ${daynightSetupActionMarkup()}
        ${preview.ok ? `
          <div class="readiness-item is-ok">
            <strong>${escapeHtml(portalMessage("portal.nextStep", "Next step"))}</strong>
            <span>${escapeHtml(portalMessage("portal.createTheNewNightTargetItIsThenSelected", "Create the new night target. It is then selected automatically and the time-control plan can be checked."))}</span>
          </div>
        ` : `
          <div class="readiness-item is-warning">
            <strong>${escapeHtml(portalMessage("portal.pleaseCorrect", "Please correct"))}</strong>
            <span>${portalMessagesMarkup(preview.blockers?.length ? preview.blockers : [portalMessage("portal.thePlanIsNotCompleteYet", "The plan is not complete yet.")], " ")}</span>
          </div>
        `}
      </section>
    `;
    updateDaynightHeaderButton();
    return;
  }
  const summary = preview.summary || {};
  const writesEnabled = liveApplyPermitted();
  const gatewayChangeCount = (summary.gatewaysToCreate || 0) + (summary.gatewaysToUpdate || 0);
  const canCreateGateways = Boolean(preview.ok && gatewayChangeCount > 0 && writesEnabled && !state.daynightGatewayApplyLoading);
  const allGatewaysReady = Boolean(preview.ok && summary.total > 0 && summary.gatewaysExisting === summary.total);
  const canRouteGateways = Boolean(allGatewaysReady && writesEnabled && !state.daynightGatewayRoutingLoading);
  const cleanupCount = summary.cleanupCandidates || preview.staleTimeControls?.length || 0;
  const managedGatewayCount = summary.gatewaysExisting || 0;
  const canCleanupGateways = Boolean(cleanupCount > 0 && writesEnabled && !state.daynightGatewayCleanupLoading && !state.daynightGatewayResetLoading);
  const canResetGateways = Boolean(managedGatewayCount > 0 && portalApplyPermitted() && !state.daynightGatewayResetLoading);
  const cleanupButtonLabel = cleanupCount > 0 ? portalMessage("portal.deleteOldTimeControls", "Delete old time controls") : portalMessage("portal.deleteTimeControls", "Delete time controls");
  const capabilities = preview.capabilities || {};
  const operationFeedback = state.daynightOperationFeedback;
  const capabilityRows = [
    [portalMessage("portal.numbers", "Numbers"), capabilities.dids],
    [portalMessage("portal.timeControls", "Time controls"), capabilities.timeControls],
    [portalMessage("portal.voiceDialogs", "Voice dialogs"), capabilities.ivrs],
    [portalMessage("portal.announcements", "Announcements"), capabilities.announcements],
    ["Frontdesk/Nia", capabilities.frontdesks],
  ];
  target.innerHTML = `
    <section class="daynight-preview-card">
      <div class="daynight-preview-header">
        <div>
          <h3>${escapeHtml(portalMessage("portal.timeControlCheck", "Time-control check"))}</h3>
          <p>${escapeHtml(preview.message || "")}</p>
        </div>
        <span class="batch-status-pill ${preview.ok ? "is-ok" : "is-warning"}">${preview.readOnly ? portalMessage("portal.readOnlyLabel", "Read only") : portalMessage("portal.readOnlyLabel", "Read only")}</span>
      </div>
      ${gatewayTargetControlMarkup()}
      ${daynightSetupActionMarkup()}
      <details><summary>${escapeHtml(portalMessage("portal.daynightAdvanced", "Details and maintenance"))}</summary>
      <div class="daynight-step-grid">
        <div class="daynight-step ${preview.ok ? "is-ok" : "is-current"}">
          <span>1</span>
          <strong>${escapeHtml(portalMessage("portal.checkPlan", "Check plan"))}</strong>
          <small>${escapeHtml(preview.ok ? portalMessage("portal.apiDataIsUnambiguous", "API data is unambiguous") : portalMessage("portal.checkBlockers", "Check blockers"))}</small>
        </div>
        <div class="daynight-step ${allGatewaysReady ? "is-ok" : gatewayChangeCount ? "is-current" : ""}">
          <span>2</span>
          <strong>${escapeHtml(portalMessage("portal.createUpdateTimeControls", "Create/update time controls"))}</strong>
          <small>${escapeHtml(portalMessage("portal.valueMatchingValueNewValueTargetsToUpdate", "{p0} matching, {p1} new, {p2} targets to update", { p0: summary.gatewaysReady || 0, p1: summary.gatewaysToCreate || 0, p2: summary.gatewaysToUpdate || 0 }))}</small>
        </div>
        <div class="daynight-step ${allGatewaysReady ? "is-current" : ""}">
          <span>3</span>
          <strong>${escapeHtml(portalMessage("portal.reassignNumbers", "Reassign numbers"))}</strong>
          <small>${escapeHtml(allGatewaysReady ? portalMessage("portal.separateLiveStep", "separate live step") : portalMessage("portal.afterCreatingTimeControls", "after creating time controls"))}</small>
        </div>
      </div>
      <div class="daynight-action-row">
        <button class="secondary-button" id="preview-daynight-gateway" type="button" ${state.daynightGatewayLoading || requiresDialogCreation ? "disabled" : ""}>${state.daynightGatewayLoading ? portalMessage("portal.checking", "Checking...") : portalMessage("portal.checkPlanAgain", "Check plan again")}</button>
        <button class="primary-button" id="apply-daynight-gateways" type="button" ${canCreateGateways ? "" : "disabled"}>${state.daynightGatewayApplyLoading ? portalMessage("portal.writingTimeControls", "Writing time controls...") : portalMessage("portal.createUpdateTimeControls", "Create/update time controls")}</button>
        <button class="secondary-button" id="cleanup-daynight-time-controls" type="button" ${canCleanupGateways ? "" : "disabled"}>${state.daynightGatewayCleanupLoading || state.daynightGatewayResetLoading ? portalMessage("portal.deleting_685a9", "Deleting...") : cleanupButtonLabel}</button>
        <button class="secondary-button" id="reset-daynight-time-controls" type="button" ${canResetGateways ? "" : "disabled"}>${state.daynightGatewayResetLoading ? portalMessage("portal.resetting", "Resetting...") : portalMessage("portal.resetNightRouting", "Reset night routing")}</button>
        <button class="danger-button" id="apply-daynight-gateway-routing" type="button" ${canRouteGateways ? "" : "disabled"}>${state.daynightGatewayRoutingLoading ? portalMessage("portal.reassigningNumbers", "Reassigning numbers...") : portalMessage("portal.reassignNumbersToTimeControls", "Reassign numbers to time controls")}</button>
      </div>
      ${operationFeedback ? `
        <div class="readiness-item ${operationFeedback.ok ? "is-ok" : "is-warning"}">
          <strong data-i18n-ignore>${escapeHtml(operationFeedback.title)}</strong>
          <span>${escapeHtml([
            operationFeedback.message,
            ...(operationFeedback.details || []),
            operationFeedback.appliedAt ? portalMessage("portal.atValue", "at {p0}", { p0: formatTime(operationFeedback.appliedAt) }) : "",
          ].filter(Boolean).join(" · "))}</span>
        </div>
      ` : ""}
      ${!writesEnabled ? `<div class="readiness-item is-warning"><strong>${escapeHtml(portalMessage("portal.liveWritesOff", "Live writes off"))}</strong><span>${escapeHtml(liveWritesDisabledText())}</span></div>` : ""}
      <div class="sync-stat-grid">
        <div><span>${escapeHtml(portalMessage("portal.numbers", "Numbers"))}</span><strong>${escapeHtml(summary.total || 0)}</strong></div>
        <div><span>${escapeHtml(portalMessage("portal.ready", "Ready"))}</span><strong>${escapeHtml(summary.ready || 0)}</strong></div>
        <div><span>${escapeHtml(portalMessage("portal.pendingTimeControls", "Pending time controls"))}</span><strong>${escapeHtml(summary.gatewaysToCreate || 0)}</strong></div>
        <div><span>${escapeHtml(portalMessage("portal.targetsToUpdate", "Targets to update"))}</span><strong>${escapeHtml(summary.gatewaysToUpdate || 0)}</strong></div>
        <div><span>${escapeHtml(portalMessage("portal.cleanupLabel", "Cleanup"))}</span><strong>${escapeHtml(cleanupCount)}</strong></div>
      </div>
      ${cleanupCount ? `
        <div class="readiness-item is-warning">
          <strong>${escapeHtml(portalMessage("portal.namingConventionValue", "Naming convention {p0}", { p0: preview.namingConvention || "TN <number>" }))}</strong>
          <span>${escapeHtml(portalMessage("portal.valueObsoleteTimeControlsCanBeDeleted", "{p0} obsolete time controls can be deleted.", { p0: cleanupCount, p1: cleanupCount === 1 ? "" : "en" }))}</span>
        </div>
      ` : ""}
      <div class="daynight-capabilities">
        ${capabilityRows.map(([label, item]) => `
          <div class="readiness-item ${item?.ok ? "is-ok" : "is-warning"}">
            <strong>${escapeHtml(label)}</strong>
            <span>${escapeHtml(item?.ok ? portalMessage("portal.valueLoaded", "{p0} loaded", { p0: item.count || 0 }) : item?.error || portalMessage("portal.notLoaded", "not loaded"))}</span>
          </div>
        `).join("")}
      </div>
      <div class="daynight-preview-table">
        <div class="daynight-preview-table-head" role="row">
          <span>${escapeHtml(portalMessage("portal.number_b7905", "Number"))}</span>
          <span>${escapeHtml(portalMessage("portal.currentDayTarget", "Current day target"))}</span>
          <span>${escapeHtml(portalMessage("portal.timeControl", "Time control"))}</span>
          <span>${escapeHtml(portalMessage("portal.nightTarget", "Night target"))}</span>
          <span>${escapeHtml(portalMessage("portal.assessment", "Assessment"))}</span>
        </div>
        ${(preview.entries || []).map((entry) => `
          <article class="daynight-preview-row ${entry.ok ? "" : "is-warning"}" role="row">
            <div data-label="Rufnummer">
              <strong data-i18n-ignore>${escapeHtml(entry.did?.name || entry.did?.id || "-")}</strong>
              <small>${escapeHtml(entry.did?.trunkNumber || "")}</small>
            </div>
            <div data-label="Aktuelles Tagesziel">
              <strong ${entry.currentTarget?.isUnassigned ? 'data-i18n-key="portal.noTarget_1186c"' : entry.currentTarget?.label ? "data-i18n-ignore" : 'data-i18n-key="portal.noTargetDetected"'}>${escapeHtml(entry.currentTarget?.label || portalMessage("portal.noTargetDetected", "No target detected"))}</strong>
              <small>${escapeHtml(`${targetTypeLabel(entry.currentTarget?.type)} ${entry.currentTarget?.routeNumber || ""}`.trim())}</small>
            </div>
            <div data-label="Zeitsteuerung">
              <strong data-i18n-ignore>${escapeHtml(entry.gateway?.name || "-")}</strong>
              <small>${daynightGatewayStatusMarkup(entry)}</small>
            </div>
            <div data-label="Nachtziel">
              <strong ${normalizeTargetType(preview.nightTarget?.type) === "HANGUP" ? 'data-i18n-key="portal.hangUp"' : preview.nightTarget?.title ? "data-i18n-ignore" : 'data-i18n-key="portal.nightTarget"'}>${escapeHtml(displayTargetName(preview.nightTarget?.type, preview.nightTarget?.title) || portalMessage("portal.nightTarget", "Night target"))}</strong>
              <small>${escapeHtml(`${targetTypeLabel(preview.nightTarget?.type)} ${preview.nightTarget?.routeNumber || ""}`.trim())}</small>
            </div>
            <div data-label="Bewertung">
              <strong>${escapeHtml(entry.ok ? portalMessage("portal.eligible", "eligible") : "Blocker")}</strong>
              <small>${daynightBehaviorMarkup(entry)}</small>
            </div>
          </article>
        `).join("")}
      </div>
      ${(preview.blockers || []).length ? `
        <div class="readiness-item is-warning">
          <strong>${escapeHtml(portalMessage("portal.blockersBeforeLiveMigration", "Blockers before live migration"))}</strong>
          <span>${portalMessagesMarkup(preview.blockers, " | ")}</span>
        </div>
      ` : ""}
      </details>
    </section>
  `;
  updateDaynightHeaderButton();
}

function renderPhonebookSync() {
  const summary = $("#phonebook-sync-summary");
  const button = $("#stage-phonebook-sync");
  if (!summary || !button) return;
  const overview = getOverview();
  const plan = state.actionPlan?.type === "phonebook-sync" ? state.actionPlan : null;
  const visiblePlan = state.phonebookManualDirty ? null : plan;
  const settings = overview?.settings || {};
  const writesEnabled = liveApplyPermitted();
  button.disabled = state.phonebookSyncLoading;
  button.textContent = state.phonebookSyncLoading ? portalMessage("portal.loading_7a72d", "Loading...") : portalMessage("portal.apply", "Apply");
  const summaryData = visiblePlan?.summary || {};
  const changeCount = Number(summaryData.create || 0) + Number(summaryData.update || 0);
  const hasChanges = changeCount > 0 && visiblePlan?.ok !== false && !visiblePlan?.applied;
  const isSynced = visiblePlan?.ok !== false && changeCount === 0 && visiblePlan && !visiblePlan.results?.length;
  const statusTitle = visiblePlan?.applied
    ? portalMessage("portal.changesApplied_ca9bb", "Changes applied")
    : isSynced
      ? portalMessage("portal.server.everythingIsInSync", "Everything is in sync")
      : visiblePlan?.title || portalMessage("portal.readyToCheck", "Ready to check");
  const statusMessage = visiblePlan?.applied
    ? visiblePlan.message || portalMessage("portal.theChangesWereSentToThePortalApi", "The changes were sent to the Portal API.")
    : isSynced
      ? portalMessage("portal.valueEntriesAreAlreadyInSyncThereAreNo", "{p0} entries are already in sync. There are no changes to apply.", { p0: summaryData.unchanged || 0 })
      : visiblePlan?.message || portalMessage("portal.theContactSourceCanBeComparedWithNfonContacts", "The contact source can be compared with NFON contacts.");
  const nfonRows = visiblePlan?.preview?.nfon?.length
    ? visiblePlan.preview.nfon
    : phonebookInventoryRows(overview?.inventory?.phoneBooks || []);
  const googleFile = settings.googleContactsFile || visiblePlan?.source?.file || "";
  const googleSourceLabel = googleFile
    ? googleFile.split(/[\\/]/).filter(Boolean).pop() || portalMessage("portal.server.contactFile", "Contact file")
    : "";
  const sourceDisplayLabel = googleSourceLabel && googleSourceLabel.toLowerCase().includes("google")
    ? portalMessage("portal.localContactSource", "Local contact source")
    : googleSourceLabel;
  const uploadFeedback = state.phonebookUploadFeedback;
  const manualPending = state.phonebookManualDirty && collectManualPhonebookRows().length > 0;

  summary.innerHTML = `
    <div class="phonebook-workspace">
      <section class="phonebook-fixed-grid">
        <form class="phonebook-card phonebook-upload-form" id="phonebook-upload-form">
          <div>
            <span class="step-label">${escapeHtml(portalMessage("portal.source", "Source"))}</span>
            <h3>${escapeHtml(portalMessage("portal.phonebookUpload", "Phonebook upload"))}</h3>
            <p class="helper-copy">CSV / JSON</p>
          </div>
          <div class="phonebook-file-row">
            <label class="phonebook-file-picker" for="phonebook-upload-file">
              <span>${escapeHtml(portalMessage("portal.selectFile", "Select file"))}</span>
              <strong id="phonebook-upload-file-name"></strong>
            </label>
            <button class="phonebook-format-help-button" id="phonebook-format-help-toggle" type="button" aria-label="${escapeHtml(portalMessage("portal.showFormatHelp", "Show format help"))}" aria-expanded="${state.phonebookFormatHelpOpen ? "true" : "false"}" aria-controls="phonebook-format-help" data-i18n-ignore>i</button>
          </div>
          <input id="phonebook-upload-file" name="phonebookFile" type="file" accept=".json,.csv,application/json,text/csv">
          ${state.phonebookFormatHelpOpen ? `
            <div class="phonebook-format-help" id="phonebook-format-help">
              <div>
                <strong>CSV</strong>
                <span>Header: firstName, name, phones</span>
                <pre>firstName,name,phones
Anna,Becker,+491701234567
Ben,Sommer,+491701234568
Clara,Wagner,+491701234569</pre>
              </div>
              <div>
                <strong>JSON</strong>
                <span>${escapeHtml(portalMessage("portal.arrayOrContactsList", "Array or contacts list"))}</span>
                <pre>{
  "contacts": [
    {"firstName":"Anna","name":"Becker","phones":"+491701234567"},
    {"firstName":"Ben","name":"Sommer","phones":"+491701234568"},
    {"firstName":"Clara","name":"Wagner","phones":"+491701234569"}
  ]
}</pre>
              </div>
            </div>
          ` : ""}
          <button class="secondary-button" type="submit">${escapeHtml(portalMessage("portal.applyFile", "Apply file"))}</button>
          <div class="phonebook-source-state">
            <strong>${escapeHtml(portalMessage("portal.activeSource", "Active source"))}</strong>
            <span>${escapeHtml(sourceDisplayLabel || portalMessage("portal.noLocalSource", "no local source"))}</span>
          </div>
          <div class="phonebook-manual-panel">
            <div>
              <span class="step-label">${escapeHtml(portalMessage("portal.manual", "Manual"))}</span>
              <h4>${escapeHtml(portalMessage("portal.addContact", "Add contact"))}</h4>
            </div>
            <div class="phonebook-manual-grid">
              <label>Vorname
                <input data-phonebook-manual-field="firstName" value="${escapeHtml(state.phonebookManualDraft.firstName)}" ${portalPlaceholderAttributes("portal.optionalField", "Optional")}>
              </label>
              <label>Name
                <input data-phonebook-manual-field="name" value="${escapeHtml(state.phonebookManualDraft.name)}" ${portalPlaceholderAttributes("portal.nameField", "Name")}>
              </label>
              <label>Rufnummer
                <input data-phonebook-manual-field="phone" value="${escapeHtml(state.phonebookManualDraft.phone)}" placeholder="+49 ...">
              </label>
            </div>
            <button class="secondary-button" id="add-phonebook-manual-contact" type="button">${escapeHtml(portalMessage("portal.addContact", "Add contact"))}</button>
            <div class="phonebook-manual-list">
              ${state.phonebookManualRows.length ? state.phonebookManualRows.map((row, index) => `
                <div class="phonebook-manual-row">
                  <strong ${([row.firstName, row.name].filter(Boolean).join(" ")) ? 'data-i18n-ignore' : 'data-i18n-key="portal.contact"'}>${escapeHtml([row.firstName, row.name].filter(Boolean).join(" ") || portalMessage("portal.contact", "Contact"))}</strong>
                  <span data-i18n-ignore>${escapeHtml(row.phone)}</span>
                  <button class="icon-button" data-phonebook-manual-remove="${index}" type="button" aria-label="Kontakt entfernen">×</button>
                </div>
              `).join("") : `<div class="empty-state is-compact">${escapeHtml(portalMessage("portal.noManualContactsYet", "No manual contacts yet."))}</div>`}
            </div>
          </div>
          ${uploadFeedback ? `<div class="sync-note ${uploadFeedback.ok ? "" : "is-warning"}"><strong data-i18n-ignore>${escapeHtml(uploadFeedback.title)}</strong><span>${escapeHtml(uploadFeedback.message)}</span></div>` : ""}
          ${manualPending ? `
            <div class="sync-note">
              <strong>${escapeHtml(portalMessage("portal.manualContactsReady", "Manual contacts ready"))}</strong>
              <span>${escapeHtml(portalMessage("portal.useApplyAtTheTopRightToSetThe", "Use Apply at the top right to set the local source and compare it with the NFON phonebook."))}</span>
            </div>
          ` : ""}
          ${visiblePlan ? `
            <div class="sync-note ${visiblePlan?.ok === false ? "is-warning" : ""}">
              <strong>${escapeHtml(statusTitle)}</strong>
              <span>${escapeHtml(statusMessage)}</span>
            </div>
          ` : ""}
          ${hasChanges ? `
            <div class="sync-apply-row">
              <button class="primary-button" id="apply-phonebook-sync-live" type="button" ${writesEnabled ? "" : "disabled"}>${escapeHtml(portalMessage("portal.applyChanges", "Apply changes"))}</button>
              <span>${escapeHtml(writesEnabled ? portalMessage("portal.valueChangesWillBeSavedInTheLivePortal", "{p0} changes will be saved in the live Portal API.", { p0: changeCount, p1: changeCount === 1 ? "" : "en" }) : portalMessage("portal.liveWritesAreDisabledGloballyInSettings", "Live writes are disabled globally in Settings."))}</span>
            </div>
          ` : ""}
        </form>

        <section class="phonebook-card phonebook-current-card">
          <div class="phonebook-preview-header">
            <div>
              <span class="step-label">NFON</span>
              <h3>${escapeHtml(portalMessage("portal.currentPhonebook", "Current phonebook"))}</h3>
            </div>
            <strong>${portalKeyedMessageMarkup("portal.valueEntries", "Entries: {p11}", { p11: nfonRows.length || visiblePlan?.target?.portalEntries || overview?.counts?.phoneBooks || 0 })}</strong>
          </div>
          <div class="phonebook-table">
            ${renderPhonebookPreviewRows(nfonRows, "nfon")}
          </div>
        </section>
      </section>

      ${(visiblePlan?.results || []).length ? `
        <section class="phonebook-card">
          <div class="phonebook-preview-header">
            <h3>${escapeHtml(portalMessage("portal.applyLog", "Applied changes log"))}</h3>
          </div>
          <div class="sync-action-preview">
            ${(visiblePlan.results || []).slice(0, 8).map((result) => `
              <div class="sync-action-row ${result.ok ? "" : "is-error"}">
                <span>${escapeHtml(result.ok ? portalMessage("portal.saved", "Saved") : portalMessage("portal.error", "Error"))}</span>
                <strong ${result.contact ? "data-i18n-ignore" : ""}>${escapeHtml(result.contact || result.action || "-")}</strong>
                <small>${escapeHtml(result.ok ? (result.location || `HTTP ${result.status}`) : result.error || `HTTP ${result.status}`)}</small>
              </div>
            `).join("")}
          </div>
        </section>
      ` : ""}
    </div>
  `;
}

function renderPhonebookPreviewRows(rows, source) {
  if (!rows?.length) {
    return `<div class="empty-state is-compact">${source === "google" ? portalMessage("portal.noApiContactsLoadedYet", "No API contacts loaded yet.") : portalMessage("portal.noNfonContactsLoaded", "No NFON contacts loaded.")}</div>`;
  }
  return rows.slice(0, 60).map((row) => `
    <div class="phonebook-row">
      <span class="phonebook-row-state is-${escapeHtml(row.status || "present")}">${escapeHtml(phonebookStatusLabel(row.status, source))}</span>
      <strong data-i18n-ignore>${escapeHtml(row.contact || "-")}</strong>
      <span data-i18n-ignore>${escapeHtml(row.phone || "-")}</span>
      ${row.reason ? `<small>${escapeHtml(row.reason)}</small>` : ""}
    </div>
  `).join("");
}

function phonebookInventoryRows(entries = []) {
  return entries.map((entry) => {
    const phones = Array.isArray(entry.phones) ? entry.phones : [];
    const primaryPhone = phones.find((phone) => phone?.value || phone?.normalized) || {};
    return {
      status: "present",
      contact: entry.name || portalMessage("portal.phonebookEntry", "Phonebook entry"),
      phone: primaryPhone.value || primaryPhone.normalized || "-",
      book: entry.bookName || portalMessage("portal.nfonPhonebook", "NFON phonebook"),
    };
  });
}

function phonebookStatusLabel(status, source) {
  return {
    create: portalMessage("portal.new", "New"),
    update: portalMessage("portal.update", "Update"),
    unchanged: "OK",
    skipped: "Skip",
    present: "NFON",
    unmapped: "NFON",
    "no-phone": portalMessage("portal.server.noNumber", "No number"),
  }[status] || (source === "google" ? portalMessage("portal.source", "Source") : "NFON");
}

function addManualPhonebookContact() {
  const draft = {
    firstName: normalizePhonebookText(state.phonebookManualDraft.firstName),
    name: normalizePhonebookText(state.phonebookManualDraft.name),
    phone: String(state.phonebookManualDraft.phone || "").trim(),
  };
  if (!draft.name || !draft.phone) {
    state.phonebookUploadFeedback = { ok: false, title: portalMessage("portal.contactIncomplete", "Contact incomplete"), message: portalMessage("portal.nameAndPhoneNumberAreRequired", "Name and phone number are required.") };
    renderPhonebookSync();
    return;
  }
  state.phonebookManualRows = [...state.phonebookManualRows, draft];
  state.phonebookManualDraft = { firstName: "", name: "", phone: "" };
  state.phonebookManualDirty = true;
  state.phonebookUploadFeedback = null;
  renderPhonebookSync();
}

function normalizePhonebookText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function removeManualPhonebookContact(index) {
  state.phonebookManualRows = state.phonebookManualRows.filter((_, rowIndex) => rowIndex !== index);
  state.phonebookManualDirty = state.phonebookManualRows.length > 0 || Object.values(state.phonebookManualDraft).some((value) => String(value || "").trim());
  renderPhonebookSync();
}

function collectManualPhonebookRows() {
  const draft = {
    firstName: normalizePhonebookText(state.phonebookManualDraft.firstName),
    name: normalizePhonebookText(state.phonebookManualDraft.name),
    phone: String(state.phonebookManualDraft.phone || "").trim(),
  };
  const rows = [...state.phonebookManualRows];
  if (draft.name && draft.phone) rows.push(draft);
  return rows;
}

async function persistManualPhonebookContacts(writeContext = state.overview?.settings?.writeContext) {
  const rows = collectManualPhonebookRows();
  if (!rows.length) return false;
  const contacts = rows.map((row, index) => ({
    id: `manual-${index + 1}`,
    firstName: row.firstName,
    lastName: row.name,
    name: [row.firstName, row.name].filter(Boolean).join(" ") || row.name,
    phones: row.phone,
  }));
  const result = await fetchJson("/api/phonebook-sync/upload", {
    method: "POST", writeContext,
    body: JSON.stringify({ contacts, source: "manuelle-kontakte", syncedAt: new Date().toISOString() }),
  });
  if (!isCurrentWriteContext(writeContext)) return false;
  if (state.overview) state.overview.settings = result.settings;
  state.phonebookManualRows = rows;
  state.phonebookManualDraft = { firstName: "", name: "", phone: "" };
  state.phonebookManualDirty = false;
  state.phonebookUploadFeedback = {
    ok: true,
    title: portalMessage("portal.manualContactsActive", "Manual contacts active"),
    message: portalMessage("portal.valueContactsWillBeUsedAsTheLocalSource", "{p0} contacts will be used as the local source.", { p0: result.contacts, p1: result.contacts === 1 ? "" : "e" }),
  };
  return true;
}

function renderLegacyPhonebookSync() {
  const summary = $("#phonebook-sync-summary");
  const button = $("#stage-phonebook-sync");
  if (!summary || !button) return;
  const overview = getOverview();
  const plan = state.actionPlan?.type === "phonebook-sync" ? state.actionPlan : null;
  const writesEnabled = liveApplyPermitted();
  button.disabled = state.phonebookSyncLoading;
  button.textContent = state.phonebookSyncLoading ? portalMessage("portal.loading_7a72d", "Loading...") : portalMessage("portal.apply", "Apply");

  if (plan) {
    const summaryData = plan.summary || {};
    const changeCount = Number(summaryData.create || 0) + Number(summaryData.update || 0);
    const hasChanges = changeCount > 0 && plan.ok !== false && !plan.applied;
    const isSynced = plan.ok !== false && changeCount === 0 && !plan.results?.length;
    const statusTitle = plan.applied
      ? portalMessage("portal.changesApplied_ca9bb", "Changes applied")
      : isSynced
        ? portalMessage("portal.server.everythingIsInSync", "Everything is in sync")
        : plan.title || portalMessage("portal.phonebookSync", "Phonebook sync");
    const statusMessage = plan.applied
      ? plan.message || portalMessage("portal.theChangesWereSentToThePortalApi", "The changes were sent to the Portal API.")
      : isSynced
        ? portalMessage("portal.valueEntriesAreAlreadyInSyncThereAreNo", "{p0} entries are already in sync. There are no changes to apply.", { p0: summaryData.unchanged || 0 })
        : plan.message || portalMessage("portal.server.differencesIdentified", "Differences identified.");
    summary.innerHTML = `
      <div class="sync-stat-grid">
        <div class="sync-stat">
          <span>${escapeHtml(portalMessage("portal.source", "Source"))}</span>
          <strong>${escapeHtml(plan.source?.googleContacts ?? "-")}</strong>
          <small>${escapeHtml(plan.source?.googleSyncedAt ? `Cache ${formatTime(plan.source.googleSyncedAt)}` : portalMessage("portal.contactSource", "Contact source"))}</small>
        </div>
        <div class="sync-stat">
          <span>${escapeHtml(portalMessage("portal.destination", "Destination"))}</span>
          <strong>${escapeHtml(plan.target?.portalEntries ?? "-")}</strong>
          <small>${escapeHtml(portalMessage("portal.nfonPhonebook", "NFON phonebook"))}</small>
        </div>
        <div class="sync-stat">
          <span>${escapeHtml(portalMessage("portal.new", "New"))}</span>
          <strong>${escapeHtml(summaryData.create ?? 0)}</strong>
          <small>${escapeHtml(portalMessage("portal.toCreate", "To create"))}</small>
        </div>
        <div class="sync-stat">
          <span>${escapeHtml(portalMessage("portal.update", "Update"))}</span>
          <strong>${escapeHtml(summaryData.update ?? 0)}</strong>
          <small>${escapeHtml(portalMessage("portal.toUpdate", "To update"))}</small>
        </div>
      </div>
      <div class="sync-note ${plan.ok === false ? "is-warning" : ""}">
        <strong>${escapeHtml(statusTitle)}</strong>
        <span>${escapeHtml(statusMessage)}</span>
      </div>
      ${hasChanges ? `
        <div class="sync-apply-row">
          <button class="primary-button" id="apply-phonebook-sync-live" type="button" ${writesEnabled ? "" : "disabled"}>${escapeHtml(portalMessage("portal.applyChanges", "Apply changes"))}</button>
          <span>${escapeHtml(writesEnabled ? portalMessage("portal.valueChangesWillBeSavedInTheLivePortal", "{p0} changes will be saved in the live Portal API.", { p0: changeCount, p1: changeCount === 1 ? "" : "en" }) : portalMessage("portal.liveWritesAreDisabledGloballyInSettings", "Live writes are disabled globally in Settings."))}</span>
        </div>
      ` : ""}
      ${(plan.actions || []).length ? `
        <div class="sync-action-preview">
          ${(plan.actions || []).slice(0, 8).map((action) => `
            <div class="sync-action-row">
              <span>${escapeHtml(action.action === "create" ? portalMessage("portal.new", "New") : portalMessage("portal.update", "Update"))}</span>
              <strong data-i18n-ignore>${escapeHtml(action.contact || "-")}</strong>
              <small data-i18n-ignore>${escapeHtml(action.phone || "")}</small>
            </div>
          `).join("")}
        </div>
      ` : ""}
      ${(plan.results || []).length ? `
        <div class="sync-action-preview">
          ${(plan.results || []).slice(0, 8).map((result) => `
            <div class="sync-action-row ${result.ok ? "" : "is-error"}">
              <span>${escapeHtml(result.ok ? portalMessage("portal.saved", "Saved") : portalMessage("portal.error", "Error"))}</span>
              <strong ${result.contact ? "data-i18n-ignore" : ""}>${escapeHtml(result.contact || result.action || "-")}</strong>
              <small>${escapeHtml(result.ok ? (result.location || `HTTP ${result.status}`) : result.error || `HTTP ${result.status}`)}</small>
            </div>
          `).join("")}
        </div>
      ` : ""}
    `;
    return;
  }

  const phoneBooks = overview?.counts?.phoneBooks ?? 0;
  summary.innerHTML = `
    <div class="sync-note">
      <strong>${escapeHtml(portalMessage("portal.phonebooksCount", "Phonebooks in the Portal API: {count}", { count: phoneBooks }))}</strong>
      <span>${escapeHtml(portalMessage("portal.thePreviewReadsTheLocalContactSourceAndCompares", "The preview reads the local contact source and compares phone numbers with the NFON phonebook. No live changes are written."))}</span>
    </div>
  `;
}

function renderSettingsSummary() {
  const target = $("#settings-summary");
  if (!target) return;
  const overview = getOverview();
  const settings = overview?.settings || {};
  const account = visibleAccount(overview);
  const connection = portalConnectionStatus(overview);
  const writesEnabled = portalLiveWritesEnabled();
  const lockMessage = portalMessage("portal.liveWritesLockedByServer", "Read-only mode is enforced by the server.");
  target.innerHTML = `
    <div class="settings-grid">
      <div class="settings-card settings-status-card ${connection.tone === "online" ? "is-ok" : "is-warning"}">
        <div class="settings-card-header">
          <span>Status</span>
          <strong>${escapeHtml(connection.label)}</strong>
        </div>
        <div class="settings-card-body">
          <div class="settings-meta-row settings-account-row">
            <strong ${account ? "data-i18n-ignore" : 'data-i18n-key="portal.server.loginRequired"'}>${escapeHtml(account || portalMessage("portal.server.loginRequired", "Login required"))}</strong>
          </div>
          ${connection.detail ? `<small>${escapeHtml(connection.detail)}</small>` : ""}
        </div>
      </div>
      <div class="settings-card settings-live-card ${writesEnabled ? "is-warning" : "is-ok"}">
        <div class="settings-card-header">
          <span>${portalMessage("portal.security", "Security")}</span>
          <strong>${writesEnabled ? portalMessage("portal.liveWritesOn", "Live writes on") : portalMessage("portal.liveWritesOff", "Live writes off")}</strong>
        </div>
        <div class="settings-card-body">
          <div class="settings-control-row settings-control-row-toggle-only">
            <button class="settings-live-switch ${writesEnabled ? "is-on" : ""}" data-live-writes="${writesEnabled ? "off" : "on"}" type="button" ${state.liveWritesSaving || !settings.configured || settings.liveWritesLocked || settings.liveWritesPermitted === false ? "disabled" : ""} aria-pressed="${writesEnabled ? "true" : "false"}" aria-label="${settings.liveWritesLocked ? escapeHtml(lockMessage) : writesEnabled ? portalMessage("portal.server.disableLiveWrites", "Disable live writes") : portalMessage("portal.enableLiveWrites", "Enable live writes")}" ${settings.liveWritesLocked ? 'aria-describedby="live-writes-lock-reason"' : ""}>
              <span class="settings-live-switch-track" aria-hidden="true"><span></span></span>
            </button>
          </div>
          ${settings.liveWritesLocked || settings.liveWritesPermitted === false ? `<small id="live-writes-lock-reason">${escapeHtml(lockMessage)}</small>` : ""}
        </div>
      </div>
    </div>
  `;
}

function renderAuthLoginPanel() {
  const target = $("#auth-login-panel");
  if (!target) return;
  const overview = getOverview();
  const settings = overview?.settings || {};
  const mode = state.authLoginMode || settings.authMode || "env";
  const draft = state.browserLoginDraft;
  const account = visibleAccount(overview);
  const activeSourceKey = settings.browserCredentialsActive ? "portal.server.browserLoginActive" : settings.sources?.environment ? "portal.envActive" : "portal.localSecretFileActive";
  const activeSource = portalMessage(activeSourceKey, settings.browserCredentialsActive ? "Browser login active" : settings.sources?.environment ? ".env active" : "Local secret file active");
  const envActive = mode !== "browser";
  const configured = Boolean(settings.configured);
  const envExample = [
    "PORTAL_BASE_URL=https://portal-api.nfon.net:8090",
    "PORTAL_API_KEY_ID=...",
    "PORTAL_API_KEY_SECRET=...",
    "PORTAL_CUSTOMER_ACCOUNT=<CUSTOMER_ACCOUNT>",
  ].join("\n");
  target.innerHTML = `
    <div class="panel-header auth-login-head">
      <div>
        <h2>${escapeHtml(portalMessage("portal.login", "Login"))}</h2>
        <p>${escapeHtml(portalMessage("portal.setPortalApiAccessViaLocalFileOrBrowser", "Set Portal API access via local file or browser form."))}</p>
      </div>
      <span class="auth-login-state ${configured ? "is-configured" : "is-required"}">${configured ? portalMessage("portal.accessConfigured", "Access configured") : portalMessage("portal.loginRequired", "Login required")}</span>
    </div>
    <div class="auth-login-body">
      <div class="auth-mode-switch" role="tablist" aria-label="Anmeldemethode">
        <button class="${envActive ? "is-active" : ""}" type="button" data-auth-login-mode="env" data-i18n-key="portal.signInViaEnv">${escapeHtml(portalMessage("portal.signInViaEnv", "Sign in via .env"))}</button>
        <button class="${!envActive ? "is-active" : ""}" type="button" data-auth-login-mode="browser" data-i18n-key="portal.signInViaBrowser">${escapeHtml(portalMessage("portal.signInViaBrowser", "Sign in via browser"))}</button>
      </div>
      ${envActive ? `
        <section class="auth-login-card is-active">
          <span>${escapeHtml(portalMessage("portal.localConfiguration", "Local configuration"))}</span>
          <h3 data-i18n-key="${activeSourceKey}">${escapeHtml(activeSource)}</h3>
          <p>Im Ordner <strong>Portal_API</strong> eine Datei <strong>.env</strong> anlegen. Der Server liest sie beim Start automatisch.</p>
          <pre>${escapeHtml(envExample)}</pre>
          <p>${escapeHtml(portalMessage("portal.restartThePortalServerAfterwardsSecretsStayLocalAnd", "Restart the Portal server afterwards. Secrets stay local and are not returned to the frontend."))}</p>
        </section>
      ` : `
        <form class="auth-login-card browser-login-form" id="browser-login-form">
          <span>${escapeHtml(portalMessage("portal.browserConfiguration", "Browser configuration"))}</span>
          <h3>${settings.browserCredentialsActive ? portalMessage("portal.accessEnabledForThisSession", "Access enabled for this session") : portalMessage("portal.setCredentialsForThisSession", "Set credentials for this session")}</h3>
          <div class="auth-form-grid">
            <label>Portal URL<input name="baseUrl" type="url" value="${escapeHtml(draft.baseUrl || settings.baseUrl || "https://portal-api.nfon.net:8090")}" placeholder="https://portal-api.nfon.net:8090" autocomplete="off"></label>
            <label>API Key ID<input name="apiKeyId" type="text" value="${escapeHtml(draft.apiKeyId)}" ${portalPlaceholderAttributes("portal.apiKeyIdField", "Key ID")} autocomplete="off"></label>
            <label>API Key Secret<input name="apiKeySecret" type="password" value="${escapeHtml(draft.apiKeySecret)}" ${portalPlaceholderAttributes("portal.apiKeySecretField", "Secret")} autocomplete="off"></label>
            <label>${escapeHtml(portalMessage("portal.pbx", "PBX"))}<input name="customerAccount" type="text" value="${escapeHtml(draft.customerAccount || account)}" ${portalPlaceholderAttributes("portal.pbxAccount", "PBX account")} autocomplete="off"></label>
          </div>
          <div class="auth-form-actions">
            <button class="primary-button" type="submit" ${state.browserLoginSaving ? "disabled" : ""}>${state.browserLoginSaving ? portalMessage("portal.checking", "Checking...") : portalMessage("portal.server.activateBrowserLogin", "Activate browser login")}</button>
            <span>Wird nur im laufenden Node-Server gespeichert. Bei Neustart gilt wieder <strong>.env</strong> oder die lokale Secret-Datei.</span>
          </div>
        </form>
      `}
      ${state.browserLoginFeedback ? `<p class="form-message ${state.browserLoginFeedback.ok ? "success" : "error"}">${escapeHtml(state.browserLoginFeedback.title)}${state.browserLoginFeedback.message ? ` — ${escapeHtml(state.browserLoginFeedback.message)}` : ""}</p>` : ""}
    </div>
  `;
}

async function applyBrowserLogin(form) {
  if (state.browserLoginSaving) return;
  const data = Object.fromEntries(new FormData(form).entries());
  state.browserLoginDraft = {
    baseUrl: String(data.baseUrl || "").trim(),
    apiKeyId: String(data.apiKeyId || "").trim(),
    apiKeySecret: String(data.apiKeySecret || "").trim(),
    customerAccount: String(data.customerAccount || "").trim(),
  };
  state.browserLoginSaving = true;
  state.browserLoginFeedback = { ok: true, title: portalMessage("portal.checkingBrowserLogin", "Checking browser login"), message: portalMessage("portal.readingThePbxUsingTheSuppliedCredentials", "Reading the PBX using the supplied credentials.") };
  renderAuthLoginPanel();
  try {
    const result = await fetchJson("/api/settings/browser-login", {
      method: "POST",
      body: JSON.stringify(state.browserLoginDraft),
    });
    state.browserLoginDraft.apiKeySecret = "";
    state.browserLoginFeedback = { ok: true, title: portalMessage("portal.server.browserLoginActive", "Browser login active"), message: result.message || portalMessage("portal.credentialsAreActiveForThisSession", "Credentials are active for this session.") };
    state.authLoginMode = "browser";
    resetAccountScopedState();
    await loadOverview();
  } catch (error) {
    state.browserLoginFeedback = { ok: false, title: portalMessage("portal.server.browserLoginFailed", "Browser login failed"), message: error.message };
  } finally {
    state.browserLoginSaving = false;
    render();
  }
}

function renderFlowPlan() {
  const panel = $("#flow-plan-panel");
  if (!panel) return;
  const plan = state.view === "callflow" && state.actionPlan?.context === "callflow" ? state.actionPlan : null;
  if (!plan || !plan.applyAttempted) {
    panel.classList.remove("is-open");
    panel.innerHTML = "";
    return;
  }

  panel.classList.add("is-open");
  panel.innerHTML = `
    <div class="plan-summary">
      <button class="plan-close" id="close-flow-plan" type="button" aria-label="Technische Details schließen">×</button>
      <details>
        <summary>${escapeHtml(portalMessage("portal.technicalDetails", "Technical details"))}</summary>
        <pre>${escapeHtml(JSON.stringify(plan, null, 2))}</pre>
      </details>
    </div>
  `;
}

function serviceFeedbackMarkup() {
  const feedback = state.serviceFeedback;
  if (!feedback) return "";
  const tone = feedback.type === "error" ? "is-error" : feedback.type === "success" ? "is-success" : "";
  return `
    <div class="service-feedback ${tone}">
      <strong data-i18n-ignore>${escapeHtml(feedback.title || "")}</strong>
      <span data-i18n-ignore>${escapeHtml(feedback.message || "")}</span>
      ${feedback.operations ? `<p>${escapeHtml(portalMessage("portal.partialMembership", "Completed: {done}. Failed: {failed}. Not attempted: {pending}.", {done:feedback.operations.completed.length,failed:1,pending:feedback.operations.notAttempted.length}))}</p>` : ""}
    </div>
  `;
}

function renderServices() {
  const feedback = $("#service-feedback");
  const createSlot = $("#service-create-slot");
  const extensionList = $("#service-extension-list");
  const board = $("#service-board");
  const inspector = $("#service-inspector");
  const filter = $("#service-extension-filter");
  if (!feedback || !createSlot || !extensionList || !board || !inspector) return;
  const workspace = board.closest(".service-workspace");

  document.querySelectorAll("[data-service-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.serviceMode === state.serviceMode);
  });
  const serviceApplyButton = $("#apply-service-draft");
  if (serviceApplyButton) {
    serviceApplyButton.disabled = state.serviceApplying || !localApplyPermitted();
    serviceApplyButton.title = localApplyPermitted() ? "" : liveWritesDisabledText();
  }
  const serviceUndoButton = $("#undo-service-draft");
  if (serviceUndoButton) {
    serviceUndoButton.disabled = !(state.serviceDraftHistory || []).length;
    serviceUndoButton.title = serviceUndoButton.disabled ? portalMessage("portal.noLocalChangeToUndo", "No local change to undo.") : portalMessage("portal.undoTheLastLocalChange", "Undo the last local change.");
  }
  feedback.hidden = !state.serviceFeedback && !state.serviceDraftConflicts?.length;
  feedback.innerHTML = serviceFeedbackMarkup() + (state.serviceDraftConflicts?.length ? `<div class="service-feedback"><span>${escapeHtml(portalMessage("portal.staleDraft", "Memberships changed. Saved changes need review."))}</span><button type="button" class="secondary-button" id="review-service-conflicts">${escapeHtml(portalMessage("portal.reviewChanges", "Review saved changes"))}</button></div>` : "");
  if (filter && filter.value !== state.serviceFilter) filter.value = state.serviceFilter;

  if (!state.serviceGroups) {
    extensionList.innerHTML = `<div class="empty-state">${state.serviceLoading ? portalMessage("portal.loadingExtensions", "Loading extensions.") : portalMessage("portal.membershipsLoadAutomatically", "Memberships load automatically.")}</div>`;
    board.innerHTML = `<div class="service-empty-board"><strong>${state.serviceLoading ? portalMessage("portal.loading", "Loading") : portalMessage("portal.readyToLoad", "Ready to load")}</strong><span>${escapeHtml(portalMessage("portal.queuesAndSkillGroupsAreReadDirectlyFromThe", "Queues and skill groups are read directly from the Portal API."))}</span></div>`;
    workspace?.classList.add("is-inspector-hidden");
    inspector.classList.add("is-hidden");
    inspector.innerHTML = "";
    return;
  }

  const overview = getOverview();
  const query = state.serviceFilter.trim().toLowerCase();
  const extensions = (overview?.inventory?.extensions || [])
    .filter((extension) => `${extension.number} ${extension.name}`.toLowerCase().includes(query));
  const selectedExtensionIds = new Set(state.selectedServiceExtensionIds || []);
  const selection = state.serviceSelection;
  const selectionBox = selection?.active
    ? `<div class="service-selection-box" style="left:${Math.min(selection.startX, selection.currentX)}px;top:${Math.min(selection.startY, selection.currentY)}px;width:${Math.abs(selection.currentX - selection.startX)}px;height:${Math.abs(selection.currentY - selection.startY)}px"></div>`
    : "";
  extensionList.innerHTML = `${selectionBox}${extensions.map((extension) => `
    <div class="service-extension-card extension-row ${selectedExtensionIds.has(String(extension.id)) || selectedExtensionIds.has(String(extension.number)) ? "is-selected" : ""}" draggable="true" tabindex="0" role="button" data-service-extension-id="${escapeHtml(extension.id)}">
      <span class="extension-number" data-i18n-ignore>${escapeHtml(extension.number || extension.id)}</span>
      <span class="extension-copy">
        <span class="extension-name" ${(extension.name) ? 'data-i18n-ignore' : 'data-i18n-key="portal.extension"'}>${escapeHtml(extension.name || portalMessage("portal.extension", "Extension"))}</span>
        <span class="extension-meta">${escapeHtml(extension.type || "PHONE")}</span>
      </span>
      <span class="extension-action">${escapeHtml(portalMessage("portal.drag", "Drag"))}</span>
    </div>
  `).join("") || `<div class="empty-state">${escapeHtml(portalMessage("portal.noExtensionFound_8e49e", "No extension found."))}</div>`}`;

  const kind = serviceTypeFromMode();
  createSlot.innerHTML = serviceCreateCardMarkup(kind);
  const services = state.serviceGroups[serviceCollectionFromKind(kind)] || [];
  if (state.selectedServiceKey && !services.some((service) => serviceKey(kind, service) === state.selectedServiceKey)) {
    state.selectedServiceKey = "";
  }
  board.classList.toggle("is-empty", !services.length);
  const serviceCards = services.map((service) => {
    const id = serviceId(service);
    const entry = serviceDraftEntry(kind, service);
    const changed = serviceHasChanges(kind, service);
    const selected = serviceKey(kind, service) === state.selectedServiceKey;
    const meta = serviceMetaFor(kind, service);
    const memberCount = service.memberError ? "—" : (meta.memberCount || 0);
    const memberPreview = (entry.members || []).slice(0, 6);
    return `
      <article class="service-card ${selected ? "is-selected" : ""} ${changed ? "has-changes" : ""}" style="${serviceColorStyle(entry.color)}" data-service-card data-service-kind="${escapeHtml(kind)}" data-service-id="${escapeHtml(id)}">
        <button class="service-card-hit" type="button" data-select-service="${escapeHtml(serviceKey(kind, service))}">
          <span class="service-card-top">
            <span class="service-kind">${kind === "skill" ? portalMessage("portal.skillGroup", "Skill group") : portalMessage("portal.queue", "Queue")}</span>
            <span class="service-member-count">${escapeHtml(portalMessage("portal.membersCount", "Members: {count}", { count: memberCount }))}</span>
          </span>
          <strong data-i18n-ignore>${escapeHtml(service.name || `${kind} ${id}`)}</strong>
          <small>${escapeHtml(id || portalMessage("portal.noNumber", "No number"))}${service.memberError ? ` · ${escapeHtml(service.memberError)}` : ""}</small>
        </button>
        <button class="node-edit-button service-edit-button" type="button" data-edit-service="${escapeHtml(serviceKey(kind, service))}" aria-label="${escapeHtml(service.name || `${kind} ${id}`)}" data-i18n-ignore aria-description="${escapeHtml(portalMessage("portal.edit", "Edit"))}">${escapeHtml(portalMessage("portal.edit", "Edit"))}</button>
        <div class="service-members">
          ${memberPreview.map((member) => `
            <div class="service-member-chip">
              <span data-i18n-ignore>${escapeHtml(member.name || portalMessage("portal.extension", "Extension"))} (${escapeHtml(member.extensionNumber)})</span>
              <button class="text-button" data-remove-service-member data-service-kind="${escapeHtml(kind)}" data-service-id="${escapeHtml(id)}" data-extension-number="${escapeHtml(member.extensionNumber)}" type="button">${escapeHtml(portalMessage("portal.remove", "Remove"))}</button>
            </div>
          `).join("")}
          ${(entry.members || []).length > memberPreview.length ? `<div class="service-member-more">${escapeHtml(portalMessage("portal.moreCount", "+{count} more", { count: (entry.members || []).length - memberPreview.length }))}</div>` : ""}
          ${service.memberError ? `<div class="service-drop-hint">${escapeHtml(portalMessage("portal.inventoryUnavailable", "Data could not be loaded."))}</div>` : (entry.members || []).length ? "" : `<div class="service-drop-hint">${escapeHtml(portalMessage("portal.dropExtensionHere", "Drop extension here"))}</div>`}
        </div>
      </article>
    `;
  }).join("");
  board.innerHTML = `
    ${serviceCards || `
      <div class="service-empty-board">
        <strong>${escapeHtml(portalMessage("portal.noValueFound", "No {p0} found.", { p0: kind === "skill" ? portalMessage("portal.skillGroups", "Skill groups") : portalMessage("portal.queues", "Queues") }))}</strong>
        <span>${kind === "skill" ? portalMessage("portal.createASkillGroupAbove", "Create a skill group above.") : portalMessage("portal.createAQueueAbove", "Create a queue above.")}</span>
      </div>
    `}
  `;

  const selected = selectedService();
  const entry = selectedServiceDraft();
  if (!selected || !entry || !state.serviceInspectorOpen) {
    workspace?.classList.add("is-inspector-hidden");
    inspector.classList.add("is-hidden");
    inspector.innerHTML = "";
    return;
  }
  workspace?.classList.remove("is-inspector-hidden");
  inspector.classList.remove("is-hidden");
  const selectedKind = serviceTypeFromMode();
  const serviceNumbers = serviceNumberMeta(entry);
  inspector.innerHTML = `
    <div class="service-inspector-head" style="${serviceColorStyle(entry.color)}">
      <span class="service-kind">${selectedKind === "skill" ? portalMessage("portal.skillGroup", "Skill group") : portalMessage("portal.queue", "Queue")}</span>
      <h3 data-i18n-ignore>${escapeHtml(selected.name || entry.serviceNumber)}</h3>
      ${serviceNumbers ? `<span class="service-number-meta">${escapeHtml(serviceNumbers)}</span>` : ""}
      <p>${escapeHtml(portalMessage("portal.membersCount", "Members: {count}", { count: (entry.members || []).length }))}</p>
    </div>
    <div class="service-color-section">
      <label class="service-color-select">Farbe im Callflow
        <select id="service-color-select" data-service-kind="${escapeHtml(selectedKind)}" data-service-id="${escapeHtml(entry.serviceNumber)}">
        ${SERVICE_COLOR_PALETTE.map((color) => `
          <option value="${escapeHtml(color.id)}" ${entry.color === color.id ? "selected" : ""}>${escapeHtml(color.label)}</option>
        `).join("")}
        </select>
      </label>
    </div>
    <div class="service-member-settings">
      ${(entry.members || []).length ? `
        <div class="service-member-settings-header">
          <strong>${selectedKind === "skill" ? portalMessage("portal.skillLevels", "Skill levels") : portalMessage("portal.priorities", "Priorities")}</strong>
          <span class="service-priority-help">${selectedKind === "skill" ? portalMessage("portal.higherNumbersGiveAStrongerSkillPreference", "Higher numbers give a stronger skill preference.") : portalMessage("portal.priority0IsCalledFirstHigherNumbersHaveLower", "Priority 0 is called first. Higher numbers have lower priority.")}</span>
        </div>
      ` : ""}
      ${(entry.members || []).map((member) => `
        <label class="service-member-setting">
          <span data-i18n-ignore>${escapeHtml(member.name || portalMessage("portal.extension", "Extension"))} (${escapeHtml(member.extensionNumber)})</span>
          ${selectedKind === "skill" ? `
            <input type="number" min="1" max="9" value="${escapeHtml(member.skillLevel || 1)}" data-update-service-member data-field="skillLevel" data-service-kind="${escapeHtml(selectedKind)}" data-service-id="${escapeHtml(entry.serviceNumber)}" data-extension-number="${escapeHtml(member.extensionNumber)}">
          ` : `
            <input type="number" min="0" max="99" value="${escapeHtml(member.penalty || 0)}" data-update-service-member data-field="penalty" data-service-kind="${escapeHtml(selectedKind)}" data-service-id="${escapeHtml(entry.serviceNumber)}" data-extension-number="${escapeHtml(member.extensionNumber)}">
          `}
        </label>
      `).join("") || `<div class="empty-state">${escapeHtml(portalMessage("portal.noMembersInTheDraftYet", "No members in the draft yet."))}</div>`}
    </div>
  `;
}

function renderEndpoints() {
  const endpoints = getOverview()?.endpoints || {};
  const overview = getOverview() || {};
  const endpointDetails = {
    version: { label: "API-Version", purpose: portalMessage("portal.server.basicCheckPortalApiReachable", "Basic check: Portal API reachable."), required: false },
    basicData: { label: portalMessage("portal.server.customerData", "Customer data"), purpose: portalMessage("portal.accountAndTenantInformationForStatusAndDiagnostics", "Account and tenant information for status and diagnostics."), required: false },
    contract: { label: portalMessage("portal.server.contract", "Contract"), purpose: portalMessage("portal.additionalContractInformationOptionalForWorkflows", "Additional contract information; optional for workflows."), required: false },
    featureStatus: { label: "Features", purpose: portalMessage("portal.optionalLicenceAndFeatureInformationA403DoesNot", "Optional licence and feature information. A 403 does not block workflows."), required: false },
    extensions: { label: portalMessage("portal.extensions", "Extensions"), purpose: portalMessage("portal.inventoryForExtensionListsBatchImportsAndTargetSelection", "Inventory for extension lists, batch imports and target selection."), required: true },
    devices: { label: portalMessage("portal.devices", "Devices"), purpose: portalMessage("portal.deviceAssociationsForExtensionsAndInventory", "Device associations for extensions and inventory."), required: true },
    trunks: { label: portalMessage("portal.server.trunks", "Trunks"), purpose: portalMessage("portal.sipTrunkInventoryForIncomingNumbers", "SIP trunk inventory for incoming numbers."), required: true },
    dids: { label: portalMessage("portal.numbers", "Numbers"), purpose: portalMessage("portal.didRoutingForCallflowAndDayNightTimeControls", "DID routing for callflow and day/night time controls."), required: true },
    phoneBooks: { label: portalMessage("portal.phonebooks", "Phonebooks"), purpose: portalMessage("portal.inventoryAndWriteTargetForPhonebookSync", "Inventory and write target for phonebook sync."), required: true },
    groups: { label: "Teams", purpose: portalMessage("portal.groupTargetsForRoutingAndCallflow", "Group targets for routing and callflow."), required: true },
    queues: { label: portalMessage("portal.queues", "Queues"), purpose: portalMessage("portal.queueTargetsAndMembershipManagement", "Queue targets and membership management."), required: true },
    skills: { label: portalMessage("portal.skillGroups", "Skill groups"), purpose: portalMessage("portal.skillTargetsAndSkillLevelManagement", "Skill targets and skill-level management."), required: true },
    voicemails: { label: portalMessage("portal.voicemail", "Voicemail"), purpose: portalMessage("portal.optionalRoutingTargets", "Additional routing targets, where supported by the API."), required: false },
    frontdesks: { label: "Frontdesk/Nia", purpose: portalMessage("portal.optionalRoutingTargets", "Additional routing targets, where supported by the API."), required: false },
    ivrs: { label: portalMessage("portal.voiceDialogs", "Voice dialogs"), purpose: portalMessage("portal.voiceDialogTargetsIncludingAnnouncementsWithAFollowUp", "Voice dialog targets, including announcements with a follow-up action."), required: true },
    timeControls: { label: portalMessage("portal.timeControls", "Time controls"), purpose: portalMessage("portal.dayNightTimeControlsAndOpeningHoursRouting", "Day/night time controls and opening-hours routing."), required: true },
    announcements: { label: portalMessage("portal.announcements", "Announcements"), purpose: portalMessage("portal.existingAudioAnnouncementsForAnnouncementTargets", "Existing audio announcements for announcement targets."), required: true },
  };

  if (!Object.keys(endpoints).length) {
    const status = portalConnectionStatus(overview);
    $("#endpoint-status").innerHTML = `<div class="empty-state">${escapeHtml(status.detail || status.label)}</div>`;
    return;
  }

  $("#endpoint-status").classList.toggle("is-collapsed", !state.technicalOpen);
  $("#toggle-technical").textContent = state.technicalOpen ? portalMessage("portal.hideDetails", "Hide details") : portalMessage("portal.showDetails", "Show details");
  $("#endpoint-status").innerHTML = Object.entries(endpointDetails).map(([key, detail]) => {
    const endpoint = endpoints[key];
    if (!endpoint) return "";
    const isOptional = endpoint.optional || !detail.required || OPTIONAL_ENDPOINT_KEYS.has(key);
    const statusLabel = endpoint.ok
      ? "OK"
      : isOptional
        ? "Optional"
        : portalMessage("portal.error", "Error");
    const countText = endpoint.ok
      ? (Number(endpoint.count) === 1 ? portalMessage("portal.1RecordLoaded", "1 record loaded") : portalMessage("portal.valueRecordsLoaded", "{p0} records loaded", { p0: endpoint.count ?? 0 }))
      : (isOptional ? portalMessage("portal.optionalEndpointUnavailable", "Optional endpoint unavailable") : portalMessage("portal.requiredEndpointUnavailable", "Required endpoint unavailable"));
    const path = endpoint.path || "";
    const errorText = portalEndpointErrorText(endpoint);
    const dataRows = endpointDataRows(key, overview);
    return `
      <div class="endpoint-item ${endpoint.ok ? "is-ok" : "is-error"}">
        <div class="endpoint-title-row">
          <strong>${escapeHtml(detail.label)}</strong>
          <span class="endpoint-badge ${endpoint.ok ? "is-ok" : isOptional ? "is-optional" : "is-error"}">${escapeHtml(statusLabel)}</span>
        </div>
        <span class="endpoint-count">${escapeHtml(countText)}</span>
        ${dataRows.length ? endpointDataRowsMarkup(dataRows) : ""}
        <p>${escapeHtml(detail.purpose)}</p>
        ${path ? `<code>${escapeHtml(path)}</code>` : ""}
        ${errorText ? `<span class="endpoint-error">${escapeHtml(errorText)}</span>` : ""}
      </div>
    `;
  }).join("");
}

function endpointDataRows(key, overview) {
  const version = overview.version || {};
  const customer = overview.customer || {};
  const contract = overview.contract || {};
  const contractRows = Object.values(contract).slice(0, 3).map((entry) => [entry.label, entry.value]);
  const account = visibleAccount(overview);

  switch (key) {
    case "version":
      return [
        ["Version", version.version || "unbekannt"],
        ["Build", version.buildTime || "unbekannt"],
        ["Host", version.host || "unbekannt"],
      ];
    case "basicData":
      return [
        [portalMessage("portal.customer", "Customer"), customer.name || "unbekannt"],
        ["Account", account || portalMessage("portal.visibleAfterLogin", "Visible after login")],
        ["Snom Transfer", customer.snomTransfer || "unbekannt"],
      ];
    case "contract":
      return contractRows.length ? contractRows : [[portalMessage("portal.server.contract", "Contract"), portalMessage("portal.noPermittedContractFieldsReturned", "No permitted contract fields returned")]];
    case "featureStatus":
      return [["Status", portalMessage("portal.noAccessToFeatureDetails", "No access to feature details")]];
    default:
      return [];
  }
}

function endpointDataRowsMarkup(rows) {
  return `
    <dl class="endpoint-data">
      ${rows.map(([label, value]) => `
        <div>
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(formatEndpointValue(value))}</dd>
        </div>
      `).join("")}
    </dl>
  `;
}

function formatEndpointValue(value) {
  if (value === true) return portalMessage("portal.yes", "Yes");
  if (value === false) return portalMessage("portal.no", "No");
  return value;
}

function serviceListPoint(event, list) {
  const rect = list.getBoundingClientRect();
  return {
    x: event.clientX - rect.left + list.scrollLeft,
    y: event.clientY - rect.top + list.scrollTop,
  };
}

function rectsIntersect(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function updateServiceExtensionSelection(event) {
  const selection = state.serviceSelection;
  if (!selection?.active) return;
  const list = selection.list;
  const point = serviceListPoint(event, list);
  selection.currentX = point.x;
  selection.currentY = point.y;
  selection.moved = Math.abs(point.x - selection.startX) > 4 || Math.abs(point.y - selection.startY) > 4;
  const selectRect = {
    left: Math.min(selection.startX, selection.currentX),
    right: Math.max(selection.startX, selection.currentX),
    top: Math.min(selection.startY, selection.currentY),
    bottom: Math.max(selection.startY, selection.currentY),
  };
  const listRect = list.getBoundingClientRect();
  state.selectedServiceExtensionIds = [...list.querySelectorAll("[data-service-extension-id]")]
    .filter((card) => {
      const rect = card.getBoundingClientRect();
      const cardRect = {
        left: rect.left - listRect.left + list.scrollLeft,
        right: rect.right - listRect.left + list.scrollLeft,
        top: rect.top - listRect.top + list.scrollTop,
        bottom: rect.bottom - listRect.top + list.scrollTop,
      };
      return rectsIntersect(selectRect, cardRect);
    })
    .map((card) => card.dataset.serviceExtensionId);
  renderServices();
}

function clearServiceSelectionBox() {
  if (!state.serviceSelection) return;
  state.serviceSelection.list?.classList.remove("is-selecting");
  state.serviceSelection = null;
  renderServices();
}

function renderView() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === `view-${state.view}`);
  });
  document.querySelectorAll("[data-extension-section]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.extensionSection === state.extensionSection);
  });
  $("#extension-section-overview")?.toggleAttribute("hidden", state.extensionSection !== "overview");
  $("#extension-section-batch")?.toggleAttribute("hidden", state.extensionSection !== "batch");
  $("#extension-filter")?.toggleAttribute("hidden", state.extensionSection !== "overview");
  $("#extension-summary")?.toggleAttribute("hidden", state.extensionSection !== "overview");
  const hasSelectedNode = Boolean(selectedNode()) || selectedNodes().length > 1;
  document.body.classList.toggle("is-callflow-mode", state.view === "callflow");
  document.body.classList.toggle("is-daynight-mode", state.daynightActive);
  document.body.classList.toggle("is-rail-collapsed", state.view === "callflow" && !state.railOpen);
  document.body.classList.toggle("is-inspector-open", state.view === "callflow" && state.inspectorOpen && hasSelectedNode);
  const endpointPanel = $(".endpoint-panel");
  endpointPanel?.classList.toggle("is-hidden", state.view !== "changes");
  $("#metrics")?.classList.toggle("is-hidden", state.view !== "overview");

  const railButton = $("#toggle-did-rail");
  if (railButton) {
    railButton.textContent = "‹";
    railButton.title = portalMessage("portal.hideMenu", "Hide menu");
    railButton.setAttribute("aria-label", railButton.title);
  }
  document.querySelectorAll("[data-flow-menu]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.flowMenu === state.activeFlowMenu);
    button.classList.toggle("is-expanded", button.dataset.flowMenu === state.activeFlowMenu && state.railOpen);
  });
  document.querySelectorAll("[data-flow-menu-content]").forEach((section) => {
    section.classList.toggle("is-active", section.dataset.flowMenuContent === state.activeFlowMenu);
  });
  const menuTitle = $("#flow-menu-title");
  if (menuTitle) menuTitle.textContent = flowMenuTitle(state.activeFlowMenu);
  updateDaynightHeaderButton();
}

function flowMenuTitle(menu) {
  return {
    dids: portalMessage("portal.numbers", "Numbers"),
    extensions: portalMessage("portal.extensions", "Extensions"),
    queues: portalMessage("portal.queues", "Queues"),
    ivrs: portalMessage("portal.voiceDialogs", "Voice dialogs"),
    skills: portalMessage("portal.skillGroups", "Skill groups"),
    timeControls: portalMessage("portal.timeControl", "Time control"),
    menus: portalMessage("portal.voiceDialogs", "Voice dialogs"),
  }[menu] || "Callflow";
}

function setView(view) {
  if (!VIEW_IDS.has(view)) return;
  const enteringCallflow = view === "callflow" && state.view !== "callflow";
  state.view = view;
  const nextHash = `#${view}`;
  if (window.location.hash !== nextHash) {
    window.history.replaceState(null, "", nextHash);
  }
  if (view === "callflow") {
    state.selectedNodeId = "";
    state.selectedNodeIds = [];
    state.inspectorOpen = false;
    state.selectedBranchField = "";
  }
  if (view === "services" && !state.serviceGroups && !state.serviceLoading) {
    loadServiceGroups();
  }
  renderView();
  if (enteringCallflow && state.overview?.settings?.configured && !state.loading && !STATIC_DEMO_MODE) loadOverview();
  if (view === "callflow") requestAnimationFrame(() => { if (state.view === "callflow") renderCallflow(); });
  if (view === "services") {
    renderServices();
  }
}

function setFlowZoom(value) {
  state.flowZoom = clamp(Number(value) || 1, FLOW_MIN_ZOOM, FLOW_MAX_ZOOM);
  renderCallflow();
}

function updateNodeField(field, value) {
  const node = selectedNode();
  if (!node || node[field] === value) return;
  rememberFlowUndo();
  clearFlowNodeDefault(node, field);
  node[field] = value;
  if (field === "title") node.titleUserEdited = true;
  if (field === "type") {
    applyNodeTypeDefaults(node, value);
    if (isComplexStepKind(value) || normalizeTargetType(value) === "PLACEHOLDER") node.isTarget = false;
    node.tone = targetTone(value);
    if (!node.targetNumber) node.targetNumber = targetNumberFromText(node.subtitle);
    state.selectedBranchField = "";
  }
  if (field === "subtitle") node.targetNumber = targetNumberFromText(value);
  syncBranchSourceConfig(node);
  if (state.flow) materializeBranchNodes(state.flow);
  saveCurrentFlowLayout();
  saveCurrentFlowDraft(false);
  state.flowFeedback = null;
  renderCallflow();
  renderFlowHelper();
  renderFlowFeedback();
}

function updateNodeFieldWithoutHelperRender(field, value) {
  const node = selectedNode();
  if (!node || node[field] === value) return;
  rememberFlowUndo({ editKey: `${node.id}:field:${field}` });
  clearFlowNodeDefault(node, field);
  node[field] = value;
  if (field === "title") node.titleUserEdited = true;
  if (field === "subtitle") node.targetNumber = targetNumberFromText(value);
  syncBranchSourceConfig(node);
  if (state.flow) materializeBranchNodes(state.flow);
  saveCurrentFlowLayout();
  saveCurrentFlowDraft(false);
  state.flowFeedback = null;
  renderCallflow();
  renderFlowFeedback();
  refreshFlowDraftPreview();
}

function clearFlowNodePortalIdentity(node) {
  // A changed type or new source must never reuse the previous Portal object.
  for (const field of ["routeNumber", "targetNumber", "number", "serviceNumber", "extensionNumber", "href", "serviceKind", "serviceColor", "serviceAccent", "serviceSoft", "memberCount", "memberNames", "memberTargets"]) delete node[field];
  node.subtitle = "";
  clearFlowNodeDefault(node, "subtitle");
}

function applyNodeTypeDefaults(node, type) {
  const kind = normalizeTargetType(type);
  node.type = kind;
  node.tone = targetTone(kind);
  clearFlowNodePortalIdentity(node);
  node.config = {};
  const defaults = flowNodeDefaultMetadata(kind);
  if (!node.titleUserEdited && (!node.title || ["Neuer Schritt", "New step", portalMessage("portal.newStep", "New step")].includes(node.title) || node.missing || node._i18nDefaults?.title)) {
    if (kind === "FRONTDESK") { node.title = "Frontdesk"; clearFlowNodeDefault(node, "title"); }
    else setFlowNodeDefault(node, "title", defaults.title || flowNodeDefaultMetadata("PLACEHOLDER").title);
  }
  if (defaults.subtitle) setFlowNodeDefault(node, "subtitle", defaults.subtitle);
  if (["QUEUE", "GROUP", "SKILL", "IVR", "TIMECONTROL"].includes(kind)) {
    node.config.portalMode = "new";
    node.isTarget = false;
  }
  if (kind === "IVR") node.config.ivrKeys = ["1", "2"];
  if (kind === "TIMECONTROL") setFlowNodeDefault(node, "config.hours", defaults["config.hours"]);
  node.missing = kind === "PLACEHOLDER";
  ensureNodeConfig(node);
}

function updateNodeConfig(field, value) {
  const node = selectedNode();
  if (!node || node.config?.[field] === value) return;
  rememberFlowUndo();
  ensureNodeConfig(node);
  if (field === "portalMode") {
    node.config.portalMode = value;
    if (value === "new") {
      clearFlowNodePortalIdentity(node);
      node.isTarget = false;
      delete node.config.timeoutSeconds;
      delete node.config.timeoutTarget;
      delete node.config.openTarget;
      delete node.config.closedTarget;
      delete node.config.afterTarget;
      node.config.announcement = "";
      node.config.ivrKeys = [];
      node.config.hours = "";
      node.missing = false;
    }
    if (value === "existing") {
      for (const key of ["timeoutTarget", "openTarget", "closedTarget", "afterTarget"]) delete node.config[key];
    }
    syncBranchSourceConfig(node);
    materializeBranchNodes(state.flow);
    saveCurrentFlowDraft(false);
    state.flowFeedback = null;
    renderCallflow();
    renderFlowHelper();
    renderFlowFeedback();
    return;
  }
  clearFlowNodeDefault(node, `config.${field}`);
  if (field === "hours" || field === "announcement") clearFlowNodeDefault(node, "subtitle");
  node.config[field] = value;
  if (normalizeTargetType(node.type) === "TIMECONTROL" && field === "hours") node.subtitle = value;
  if (["announcement"].includes(field) && value) node.subtitle = value;
  syncBranchSourceConfig(node);
  if (state.flow) materializeBranchNodes(state.flow);
  saveCurrentFlowDraft(false);
  state.flowFeedback = null;
  renderCallflow();
  renderFlowHelper();
  renderFlowFeedback();
}

function updateNodeConfigWithoutHelperRender(field, value) {
  const node = selectedNode();
  if (!node || field === "portalMode" || node.config?.[field] === value) return;
  rememberFlowUndo({ editKey: `${node.id}:config:${field}` });
  ensureNodeConfig(node);
  clearFlowNodeDefault(node, `config.${field}`);
  if (field === "hours" || field === "announcement") clearFlowNodeDefault(node, "subtitle");
  node.config[field] = value;
  if (normalizeTargetType(node.type) === "TIMECONTROL" && field === "hours") node.subtitle = value;
  if (["announcement"].includes(field) && value) node.subtitle = value;
  syncBranchSourceConfig(node);
  if (state.flow) materializeBranchNodes(state.flow);
  saveCurrentFlowDraft(false);
  state.flowFeedback = null;
  renderCallflow();
  renderFlowFeedback();
  refreshFlowDraftPreview();
}

function applyResourceTargetSelection(value) {
  if (!value) return;
  let target;
  try {
    target = JSON.parse(value);
  } catch {
    return;
  }
  const node = selectedNode();
  if (!node || node.locked) return;
  rememberFlowUndo();
  applyTargetToNode(node, target);
  ensureNodeConfig(node);
  node.config.portalMode = "existing";
  syncBranchSourceConfig(node);
  materializeBranchNodes(state.flow);
  saveCurrentFlowLayout();
  saveCurrentFlowDraft(false);
  state.flowFeedback = null;
  renderCallflow();
  renderFlowHelper();
  renderFlowFeedback();
}

function updateNodeTargetConfig(field, value) {
  const node = selectedNode();
  if (!node) return;
  ensureNodeConfig(node);
  if (!value) {
    rememberFlowUndo();
    const ivrKey = ivrKeyFromField(field);
    if (normalizeTargetType(node.type) === "IVR" && ivrKey) {
      removeIvrKey(node, ivrKey);
    } else {
      delete node.config[field];
      removeBranch(state.flow, node, field);
    }
    syncBranchSourceConfig(node);
    materializeBranchNodes(state.flow);
    saveCurrentFlowLayout();
    saveCurrentFlowDraft(false);
    state.flowFeedback = null;
    renderCallflow();
    renderFlowHelper();
    renderFlowFeedback();
    return;
  }
  let target;
  try {
    target = JSON.parse(value);
  } catch {
    return;
  }
  if (JSON.stringify(node.config[field]) === JSON.stringify(target)) return;
  rememberFlowUndo();
  node.config[field] = target;
  const ivrKey = ivrKeyFromField(field);
  if (normalizeTargetType(node.type) === "IVR" && ivrKey) {
    node.config.ivrKeys = [...new Set([...ivrKeyNumbers(node), ivrKey])];
    node.config.ivrKeysVerified = true;
  }
  syncBranchSourceConfig(node);
  materializeBranchNodes(state.flow);
  const branchNode = branchTargetNode(node, field);
  if (branchNode) {
    applyTargetToNode(branchNode, target);
    syncBranchSourceConfig(branchNode);
  }
  saveCurrentFlowDraft(false);
  state.flowFeedback = null;
  renderCallflow();
  renderFlowHelper();
  renderFlowFeedback();
}

function addIvrKey(nodeId) {
  const node = (state.flow?.nodes || []).find((item) => item.id === nodeId);
  if (!node || normalizeTargetType(node.type) !== "IVR") return;
  ensureNodeConfig(node);
  const key = nextIvrKey(node);
  if (!key) return;
  rememberFlowUndo();
  node.config.ivrKeys = [...new Set([...ivrKeyNumbers(node), key])];
  syncBranchSourceConfig(node);
  materializeBranchNodes(state.flow);
  saveCurrentFlowLayout();
  saveCurrentFlowDraft(false);
  state.flowFeedback = null;
  renderCallflow();
  renderFlowHelper();
  renderFlowFeedback();
}

function addFlowNode(fromId = "", toId = "") {
  if (!state.flow) return;
  materializeBranchNodes(state.flow);
  const nodes = state.flow.nodes || [];
  const edges = state.flow.edges || [];
  const exactEdge = edges.find((edge) => edge.from === fromId && edge.to === toId);
  const selected = nodes.find((node) => node.id === fromId)
    || selectedNode()
    || nodes.find((node) => node.id === "inbound")
    || nodes[0]
    || { id: "inbound", x: 22, y: 44 };
  const inferredBranchEdge = !exactEdge
    ? edges.find((edge) => edge.from === selected.id && edge.branchField)
    : null;
  if (inferredBranchEdge) {
    addFlowNode(inferredBranchEdge.from, inferredBranchEdge.to);
    return;
  }
  rememberFlowUndo();
  const target = nodes.find((node) => node.id === (exactEdge?.to || ""));
  const id = `local-${Date.now()}`;
  const x = exactEdge && target
    ? clamp(((Number(selected.x) || 20) + (Number(target.x) || 60)) / 2, 2, 82)
    : Math.min((Number(selected.x) || 20) + 16, 82);
  const y = exactEdge && target
    ? clamp(((Number(selected.y) || 35) + (Number(target.y) || 50)) / 2, 4, 78)
    : Math.min((Number(selected.y) || 35) + 14, 78);
  const position = vacantFlowPosition(x, y, buildVisibleFlowGraph(state.flow).nodes);
  const next = {
    id,
    type: "PLACEHOLDER",
    _i18nDefaults: flowNodeDefaultMetadata("PLACEHOLDER"),
    title: portalMessage("portal.newStep", "New step"),
    subtitle: portalMessage("portal.selectType", "Select type"),
    x: position.x,
    y: position.y,
    tone: targetTone("PLACEHOLDER"),
    missing: true,
    config: {},
  };
  state.flow.nodes.push(next);

  if (exactEdge) {
    if (exactEdge.branchField) {
      const source = nodes.find((node) => node.id === exactEdge.from);
      if (source) {
        markBranchTarget(next, source, branchSpec(exactEdge.branchField, exactEdge.label || "danach", portalMessage("portal.newStep", "New step"), portalMessage("portal.selectType", "Select type"), 0, 0));
        ensureNodeConfig(source);
        delete source.config[exactEdge.branchField];
      }
      if (target?.branchTarget && target.sourceId === exactEdge.from && target.branchField === exactEdge.branchField) {
        delete target.branchTarget;
        delete target.sourceId;
        delete target.branchField;
      }
    }
    exactEdge.to = id;
    state.flow.edges.push({ from: id, to: toId, label: "danach" });
  } else if (selected.isTarget) {
    const incoming = edges.find((edge) => edge.to === selected.id);
    if (incoming) {
      incoming.to = id;
      state.flow.edges.push({ from: id, to: selected.id, label: "danach" });
    } else {
      state.flow.edges.push({ from: id, to: selected.id, label: "danach" });
    }
  } else {
    const outgoing = edges.find((edge) => edge.from === selected.id);
    if (outgoing) {
      const oldTarget = outgoing.to;
      outgoing.to = id;
      state.flow.edges.push({ from: id, to: oldTarget, label: "danach" });
    } else {
      state.flow.edges.push({ from: selected.id, to: id, label: "danach" });
    }
  }
  state.selectedNodeId = id;
  state.selectedNodeIds = [];
  state.selectedBranchField = "";
  state.inspectorOpen = false;
  saveCurrentFlowLayout();
  saveCurrentFlowDraft(false);
  state.flowFeedback = null;
  render();
}

function addPaletteNodeToCanvas(target, point) {
  if (!state.flow || !target) return;
  rememberFlowUndo();
  const id = `local-${Date.now()}`;
  const node = {
    id,
    type: normalizeTargetType(target.type || "PLACEHOLDER"),
    title: target.title || portalMessage("portal.newStep", "New step"),
    subtitle: target.subtitle || targetTypeLabel(target.type),
    targetNumber: target.targetNumber || "",
    routeNumber: target.routeNumber || "",
    href: target.href || "",
    ...safeFlowPosition((point.x / FLOW_WORLD_WIDTH) * 100, (point.y / FLOW_POSITION_HEIGHT) * 100),
    tone: target.tone || targetTone(target.type),
    config: target.config ? clone(target.config) : {},
    floating: true,
  };
  applyTargetToNode(node, target);
  ensureNodeConfig(node);
  if (RESOURCE_STEP_KINDS.has(normalizeTargetType(node.type)) && !node.config.portalMode) {
    node.config.portalMode = "existing";
  }
  node.id = id;
  Object.assign(node, vacantFlowPosition((point.x / FLOW_WORLD_WIDTH) * 100, (point.y / FLOW_POSITION_HEIGHT) * 100,
    buildVisibleFlowGraph(state.flow).nodes, node));
  node.floating = true;
  state.flow.nodes.push(node);
  state.selectedNodeId = id;
  state.selectedNodeIds = [];
  state.selectedBranchField = "";
  state.inspectorOpen = false;
  saveCurrentFlowLayout();
  saveCurrentFlowDraft(false);
  state.flowFeedback = null;
  render();
}

function flowExtensionTarget(target) {
  if (!target) return null;
  const number = target.targetNumber || target.number || target.extensionNumber || "";
  if (!number) return null;
  return {
    type: "PHONEEXTENSION",
    title: target.title || portalMessage("portal.extensionValue", "Extension {p0}", { p0: number }),
    subtitle: portalMessage("portal.extensionValue", "Extension {p0}", { p0: number }),
    targetNumber: number,
    routeNumber: number,
    tone: "green",
    extensionId: target.extensionId || number,
  };
}

function serviceForFlowNode(node) {
  const kind = normalizeTargetType(node?.type);
  if (!["QUEUE", "GROUP", "SKILL"].includes(kind)) return null;
  const serviceKind = ["GROUP", "SKILL"].includes(kind) ? "skill" : "queue";
  const service = findServiceForTarget(kind, node.routeNumber, node.targetNumber, node.title);
  if (!service) return null;
  return { kind: serviceKind, service };
}

function serviceContextForFlowNode(node) {
  const direct = serviceForFlowNode(node);
  if (direct) return { ...direct, node };
  if (!node?.memberNode || !node.serviceNodeId) return null;
  const serviceNode = (state.flow?.nodes || []).find((item) => item.id === node.serviceNodeId);
  const serviceRef = serviceForFlowNode(serviceNode);
  return serviceRef ? { ...serviceRef, node: serviceNode } : null;
}

function updateServiceNodeMeta(node, serviceRef) {
  if (!node || !serviceRef?.service) return;
  const meta = serviceMetaFor(serviceRef.kind, serviceRef.service);
  Object.assign(node, {
    serviceKind: meta.serviceKind || node.serviceKind,
    serviceColor: meta.serviceColor || node.serviceColor,
    serviceAccent: meta.serviceAccent || node.serviceAccent,
    serviceSoft: meta.serviceSoft || node.serviceSoft,
    memberCount: meta.memberCount,
    memberNames: meta.memberNames || [],
    memberTargets: meta.memberTargets || [],
  });
}

function ensureServiceNodeExpanded(nodeId) {
  if (!nodeId) return;
  const expanded = new Set(state.expandedServiceNodeIds || []);
  expanded.add(nodeId);
  state.expandedServiceNodeIds = [...expanded];
}

function flowNodeExtensionNumber(node) {
  if (!node) return "";
  const kind = normalizeTargetType(node.type);
  if (!["PHONEEXTENSION", "PHONE"].includes(kind)) return "";
  return node.targetNumber || node.routeNumber || targetNumberFromText(node.subtitle) || "";
}

function applyServiceMembershipConnection(first, second) {
  const serviceContext = [first, second].map(serviceContextForFlowNode).find(Boolean);
  const serviceNode = serviceContext?.node;
  const extensionNode = [first, second].find((node) => flowNodeExtensionNumber(node) && !serviceForFlowNode(node) && node.id !== serviceNode?.id && !node.memberNode)
    || [first, second].find((node) => flowNodeExtensionNumber(node) && node.id !== serviceNode?.id);
  if (!serviceNode || !extensionNode) return false;
  const serviceRef = serviceContext;
  const extensionNumber = flowNodeExtensionNumber(extensionNode);
  if (!serviceRef || !extensionNumber) return false;
  const undo = rememberFlowUndo({ service: true });
  addServiceMembers(serviceRef.kind, serviceId(serviceRef.service), [extensionNumber]);
  const storedServiceNode = (state.flow?.nodes || []).find((node) => node.id === serviceNode.id) || serviceNode;
  updateServiceNodeMeta(storedServiceNode, serviceRef);
  ensureServiceNodeExpanded(storedServiceNode.id);
  setServiceMemberLayout(storedServiceNode.id, serviceMemberKey({ number: extensionNumber }), {
    x: extensionNode.x,
    y: extensionNode.y,
  });

  const storedExtensionNode = (state.flow?.nodes || []).find((node) => node.id === extensionNode.id);
  if (storedExtensionNode?.floating) {
    state.flow.nodes = (state.flow.nodes || []).filter((node) => node.id !== storedExtensionNode.id);
    state.flow.edges = (state.flow.edges || []).filter((edge) => edge.from !== storedExtensionNode.id && edge.to !== storedExtensionNode.id);
  }

  saveCurrentFlowLayout();
  saveCurrentFlowDraft(false);
  state.flowFeedback = null;
  state.selectedNodeId = serviceMemberNodeId(storedServiceNode.id, serviceMemberKey({ number: extensionNumber }));
  state.selectedNodeIds = [];
  state.selectedBranchField = "";
  state.inspectorOpen = false;
  finishFlowMembershipUndo(undo);
  render();
  return true;
}

function assignExtensionToBranchSource(source, target) {
  const branchField = firstAvailableBranchField(source);
  if (!branchField) return false;
  rememberFlowUndo();
  ensureNodeConfig(source);
  source.config[branchField] = targetFromFlowNode(target);
  syncBranchSourceConfig(source);
  materializeBranchNodes(state.flow);
  const branchNode = (state.flow.nodes || []).find((node) => node.sourceId === source.id && node.branchField === branchField);
  if (branchNode) applyTargetToNode(branchNode, target);
  finalizeFlowMutation();
  return true;
}

function assignExtensionDropToNode(targetNode, extensionTarget, point) {
  if (!state.flow || !targetNode || !extensionTarget) return false;
  const kind = normalizeTargetType(targetNode.type);
  const serviceContext = serviceContextForFlowNode(targetNode);
  if (serviceContext) {
    const serviceRef = serviceContext;
    const serviceNode = serviceContext.node;
    const extensionNumber = extensionTarget.extensionId || extensionTarget.targetNumber;
    const undo = rememberFlowUndo({ service: true });
    addServiceMembers(serviceRef.kind, serviceId(serviceRef.service), [extensionNumber]);
    updateServiceNodeMeta(serviceNode, serviceRef);
    ensureServiceNodeExpanded(serviceNode.id);
    if (point && extensionNumber) {
      setServiceMemberLayout(serviceNode.id, serviceMemberKey({ number: extensionNumber }), {
        x: (point.x / FLOW_WORLD_WIDTH) * 100,
        y: (point.y / FLOW_POSITION_HEIGHT) * 100,
      });
    }
    saveCurrentFlowLayout();
    saveCurrentFlowDraft(false);
    state.flowFeedback = null;
    finishFlowMembershipUndo(undo);
    render();
    return true;
  }
  if (targetNode.branchTarget) {
    rememberFlowUndo();
    applyTargetToNode(targetNode, extensionTarget);
    syncBranchSourceConfig(targetNode);
    finalizeFlowMutation();
    return true;
  }
  if (["IVR", "TIMECONTROL", "ANNOUNCEMENT"].includes(kind)) {
    return assignExtensionToBranchSource(targetNode, extensionTarget);
  }
  addPaletteNodeToCanvas(extensionTarget, point || { x: nodeWorldBox(targetNode).centerX + 260, y: nodeWorldBox(targetNode).centerY });
  connectFlowNodes(targetNode.id, state.selectedNodeId, { skipUndo: true });
  return true;
}

function firstAvailableBranchField(node) {
  const kind = normalizeTargetType(node?.type);
  ensureNodeConfig(node);
  if (kind === "TIMECONTROL") {
    if (!node.config.openTarget) return "openTarget";
    if (!node.config.closedTarget) return "closedTarget";
  }
  if (kind === "IVR") {
    const key = ivrKeyNumbers(node).find((item) => !node.config[ivrTargetField(item)]) || nextIvrKey(node);
    if (key) {
      node.config.ivrKeys = [...new Set([...ivrKeyNumbers(node), key])];
      node.config.ivrKeysVerified = true;
      return ivrTargetField(key);
    }
    if (!node.config.timeoutTarget) return "timeoutTarget";
  }
  if (kind === "ANNOUNCEMENT" && !node.config.afterTarget) return "afterTarget";
  return "";
}

function flowDirectionRank(node) {
  const kind = normalizeTargetType(node?.type);
  if (node?.locked || kind === "DID") return 0;
  if (["TIMECONTROL", "IVR", "ANNOUNCEMENT"].includes(kind)) return 20;
  if (["QUEUE", "GROUP", "SKILL"].includes(kind)) return 40;
  if (["FRONTDESK", "PHONEEXTENSION", "PHONE", "VOICEMAIL", "HANGUP"].includes(kind)) return 60;
  return 50;
}

function resolveLogicalConnection(first, second) {
  const firstRank = flowDirectionRank(first);
  const secondRank = flowDirectionRank(second);
  if (firstRank !== secondRank) {
    return firstRank < secondRank ? { source: first, target: second } : { source: second, target: first };
  }
  const firstBox = nodeWorldBox(first);
  const secondBox = nodeWorldBox(second);
  const firstScore = firstBox.centerX + firstBox.centerY * 0.35;
  const secondScore = secondBox.centerX + secondBox.centerY * 0.35;
  return firstScore <= secondScore ? { source: first, target: second } : { source: second, target: first };
}

function clearPairConnections(flow, firstId, secondId) {
  const removed = [];
  flow.edges = (flow.edges || []).filter((edge) => {
    const isPair = (edge.from === firstId && edge.to === secondId) || (edge.from === secondId && edge.to === firstId);
    if (isPair) removed.push(edge);
    return !isPair;
  });
  removed.forEach((edge) => {
    if (!edge.branchField) return;
    const source = (flow.nodes || []).find((node) => node.id === edge.from);
    clearBranchConfig(source, edge.branchField);
  });
}

function connectFlowNodes(fromId, toId, { skipUndo = false } = {}) {
  if (!state.flow || !fromId || !toId || fromId === toId) return;
  const first = (state.flow.nodes || []).find((node) => node.id === fromId) || visibleFlowNodeById(fromId);
  const second = (state.flow.nodes || []).find((node) => node.id === toId) || visibleFlowNodeById(toId);
  if (!first || !second || first.locked && second.locked) return;
  if (applyServiceMembershipConnection(first, second)) return;
  if (first.virtual || second.virtual) return;
  const { source, target } = resolveLogicalConnection(first, second);
  if (!skipUndo) rememberFlowUndo();
  clearPairConnections(state.flow, source.id, target.id);
  const branchField = firstAvailableBranchField(source);
  if (branchField) {
    ensureNodeConfig(source);
    source.config[branchField] = targetFromFlowNode(target);
    const label = branchField === "openTarget"
      ? "innerhalb"
      : branchField === "closedTarget"
        ? portalMessage("portal.outside", "Outside")
        : ivrKeyFromField(branchField)
          ? portalMessage("portal.keyValue", "Key {p0}", { p0: ivrKeyFromField(branchField) })
          : branchField === "afterTarget"
            ? "danach"
            : portalMessage("portal.routesTo", "routes to");
    state.flow.edges = (state.flow.edges || []).filter((edge) => !(edge.from === source.id && edge.branchField === branchField));
    state.flow.edges.push({ from: source.id, to: target.id, label, branchField });
    markBranchTarget(target, source, branchSpec(branchField, label, target.title, target.subtitle, 0, 0, targetFromFlowNode(target)));
  } else {
    state.flow.edges = (state.flow.edges || []).filter(edge => edge.from !== source.id || edge.branchField);
    state.flow.edges.push({ from: source.id, to: target.id, label: portalMessage("portal.routesTo", "routes to") });
  }
  syncBranchSourceConfig(source);
  const reachable = reachableFlowNodeIds(state.flow);
  source.floating = !reachable.has(source.id);
  target.floating = false;
  materializeBranchNodes(state.flow);
  saveCurrentFlowLayout();
  saveCurrentFlowDraft(false);
  state.flowFeedback = null;
  state.selectedNodeId = target.id;
  render();
}

function removeServiceMemberFlowNode(memberNode) {
  if (!state.flow || !memberNode?.memberNode) return false;
  const serviceContext = serviceContextForFlowNode(memberNode);
  const serviceNode = serviceContext?.node;
  const service = serviceContext?.service;
  const extensionNumber = flowNodeExtensionNumber(memberNode) || memberNode.memberKey || "";
  if (!serviceContext || !serviceNode || !service || !extensionNumber) return false;

  const entry = serviceDraftEntry(serviceContext.kind, service);
  const nextMembers = (entry.members || []).filter((member) => {
    const number = member.extensionNumber || member.number || member.id || "";
    return String(number) !== String(extensionNumber);
  });
  if (nextMembers.length === (entry.members || []).length) return false;
  const undo = rememberFlowUndo({ service: true });
  rememberServiceDraftChange();
  entry.members = nextMembers;
  const layouts = serviceMemberLayouts(serviceNode);
  delete layouts[String(memberNode.memberKey || extensionNumber)];
  writeStoredServiceDraft(state.serviceDraft);
  updateServiceNodeMeta(serviceNode, serviceContext);
  ensureServiceNodeExpanded(serviceNode.id);
  saveCurrentFlowLayout();
  saveCurrentFlowDraft(false);
  state.selectedNodeId = serviceNode.id;
  state.selectedNodeIds = [];
  state.selectedBranchField = "";
  state.inspectorOpen = false;
  state.flowFeedback = null;
  finishFlowMembershipUndo(undo);
  render();
  return true;
}

function stageFlowPlan(options = {}) {
  const did = selectedDid();
  const target = flowStartNode();
  const before = `${did?.name || "-"} → ${did?.value || portalMessage("portal.noTarget_1186c", "No target")}`;
  const after = `${did?.name || "-"} → ${currentDraftTarget()}`;
  const validation = validateFlowDetails();
  saveCurrentFlowDraft(false);
  state.actionPlan = {
    ok: validation.ok,
    context: "callflow",
    writeContext: state.flow?.writeContext,
    dryRun: true,
    title: validation.ok
      ? validation.liveCapable
        ? (validation.complex ? portalMessage("portal.complexCallflowChecked", "Complex callflow checked") : portalMessage("portal.directChangeChecked", "Direct change checked"))
        : portalMessage("portal.draftSavedLocally", "Draft saved locally")
      : portalMessage("portal.callflowIncomplete", "Callflow incomplete"),
    message: validation.ok
      ? (validation.liveCapable
        ? (validation.complex
          ? portalMessage("portal.theFlowCanBeCreatedAsPortalTargetObjects", "The flow can be created as Portal target objects and routed to the number.")
          : portalMessage("portal.theDirectTargetChangeCanBeAppliedLive", "The direct target change can be applied live."))
        : portalMessage("portal.theFlowIsSavedLocally", "The flow is saved locally."))
      : validation.ambiguous ? validation.problems.join(" · ") : portalMessage("portal.missingValue", "Missing: {p0}", { p0: validation.problems.join(" · ") }),
    did: did?.name || "",
    before,
    after,
    checks: validation.checks,
    problems: validation.problems,
    flow: state.flow,
    applyPayload: validation.liveCapable ? {
      did: {
        id: did?.id || "",
        name: did?.name || "",
        href: did?.href || "",
        trunkHref: (getOverview()?.inventory?.trunks || []).find((trunk) => trunk.name === did?.trunkNumber || trunk.value === did?.trunkNumber)?.id || "",
        didExtension: did?.didExtension || "",
        destinationName: did?.destinationName || did?.value || "",
        destinationType: did?.destinationType || "",
        destinationExtension: did?.destinationExtension || "",
        destinationServiceNumber: did?.destinationServiceNumber || "",
      },
      target: {
        type: target?.type || "",
        title: target?.title || "",
        subtitle: target?.subtitle || "",
        number: target?.targetNumber || targetNumberFromText(target?.subtitle),
        routeNumber: target?.routeNumber || "",
      },
      flow: state.flow,
    } : null,
    createdAt: new Date().toISOString(),
  };
  state.flowFeedback = {
    ok: validation.ok,
    title: state.actionPlan.title,
    message: state.actionPlan.message,
  };
  if (options.silent) return;
  renderFlowFeedback();
  renderFlowPlan();
}

async function stageAndApplyFlowPlan() {
  if (state.flowApplying) return;
  stageFlowPlan({ silent: true });
  const plan = state.actionPlan;
  if (plan) plan.directApply = true;
  if (!plan?.applyPayload || plan.ok === false) {
    if (plan) plan.applyAttempted = true;
    showUiNotice({
      title: plan?.title || portalMessage("portal.callflowNotApplied", "Callflow not applied"),
      message: plan?.message || portalMessage("portal.theCallflowCannotBeAppliedLive", "The callflow cannot be applied live."),
      type: plan?.ok === false ? "error" : "warning",
    });
    renderFlowFeedback();
    renderFlowPlan();
    return;
  }
  if (!localApplyPermitted()) {
    plan.applyAttempted = true;
    showUiNotice({ title: portalMessage("portal.liveWritesDisabled", "Live writes disabled"), message: liveWritesDisabledText(), type: "warning" });
    renderFlowFeedback();
    renderFlowPlan();
    return;
  }
  await applyFlowPlan();
}

function rememberFlowUndo({ editKey = "", service = false } = {}) {
  if (!state.flow) return null;
  const key = flowDraftKey();
  if (editKey && flowTextUndo?.key === editKey && flowTextUndo.entry === flowUndoHistory.at(-1) && flowTextUndo.entry.key === key) return flowTextUndo.entry;
  const entry = { key, flow: clone(state.flow), expandedServiceNodeIds: [...state.expandedServiceNodeIds] };
  if (service) {
    ensureServiceDraft();
    entry.serviceDraft = cloneServiceDraft();
    entry.serviceHistoryBefore = [...state.serviceDraftHistory];
  }
  flowUndoHistory.push(entry);
  flowTextUndo = editKey ? { key: editKey, entry } : null;
  if (flowUndoHistory.length > 20) flowUndoHistory.shift();
  return entry;
}

function finishFlowMembershipUndo(entry) {
  if (!entry?.serviceDraft) return;
  entry.serviceDraftAfter = cloneServiceDraft();
  entry.serviceHistoryAdded = state.serviceDraftHistory.filter(snapshot => !entry.serviceHistoryBefore.includes(snapshot));
}

// Revert only the memberships changed by this canvas action. Independent edits
// made in the Services view keep their values and their own usable history.
function reverseFlowMembershipChange(draft, entry) {
  const result = cloneServiceDraft(draft);
  if (!result || !entry.serviceDraftAfter) return result;
  const memberKey = member => String(member.extensionNumber || member.number || member.id || "");
  for (const collection of ["queues", "skills"]) {
    for (const [id, before] of Object.entries(entry.serviceDraft[collection] || {})) {
      const after = entry.serviceDraftAfter[collection]?.[id];
      const current = result[collection]?.[id];
      if (!after || !current) continue;
      const oldMembers = new Map((before.members || []).map(member => [memberKey(member), member]));
      const newMembers = new Map((after.members || []).map(member => [memberKey(member), member]));
      const currentMembers = new Map((current.members || []).map(member => [memberKey(member), member]));
      for (const key of new Set([...oldMembers.keys(), ...newMembers.keys()])) {
        const oldMember = oldMembers.get(key);
        const newMember = newMembers.get(key);
        if (JSON.stringify(oldMember) === JSON.stringify(newMember)) continue;
        // A later edit to this same membership takes precedence over stale undo.
        if (JSON.stringify(currentMembers.get(key)) !== JSON.stringify(newMember)) continue;
        if (oldMember) currentMembers.set(key, clone(oldMember));
        else currentMembers.delete(key);
      }
      current.members = [...currentMembers.values()].sort((a, b) => memberKey(a).localeCompare(memberKey(b), undefined, { numeric: true }));
    }
  }
  return result;
}

function undoFlowChange() {
  const index = flowUndoHistory.findLastIndex(entry => entry.key === flowDraftKey());
  if (index < 0) return;
  const [previous] = flowUndoHistory.splice(index, 1);
  flowTextUndo = null;
  state.flow = clone(previous.flow);
  state.expandedServiceNodeIds = previous.expandedServiceNodeIds || [];
  if (previous.serviceDraftAfter) {
    state.serviceDraft = reverseFlowMembershipChange(state.serviceDraft, previous);
    state.serviceDraftHistory = state.serviceDraftHistory
      .filter(snapshot => !previous.serviceHistoryAdded.includes(snapshot))
      .map(snapshot => previous.serviceHistoryBefore.includes(snapshot) ? snapshot : Object.assign(snapshot, reverseFlowMembershipChange(snapshot, previous)));
    writeStoredServiceDraft(state.serviceDraft);
    refreshFlowServiceNodeMeta();
  }
  state.selectedNodeId = "";
  state.selectedNodeIds = [];
  state.inspectorOpen = false;
  state.actionPlan = null;
  state.flowFeedback = null;
  saveCurrentFlowLayout();
  saveCurrentFlowDraft(false);
  render();
}

function deleteSelectedNode() {
  const node = selectedNode();
  if (!state.flow || !node || node.locked) return;
  if (node.memberNode) {
    removeServiceMemberFlowNode(node);
    return;
  }
  rememberFlowUndo();
  const incomingBranch = node.branchTarget && node.sourceId && node.branchField
    ? { from: node.sourceId, branchField: node.branchField }
    : (state.flow.edges || []).find((edge) => edge.to === node.id && edge.branchField);
  if (incomingBranch) {
    const source = (state.flow.nodes || []).find((item) => item.id === incomingBranch.from);
    if (source) {
      clearBranchConfig(source, incomingBranch.branchField);
      removeBranch(state.flow, source, incomingBranch.branchField);
      finalizeFlowMutation();
      return;
    }
  }

  const hasBranchChildren = (state.flow.edges || []).some((edge) => edge.from === node.id && edge.branchField);
  if (hasBranchChildren) {
    removeNodeSet(state.flow, collectSubtreeNodeIds(state.flow, node.id));
    finalizeFlowMutation();
    return;
  }

  const incoming = state.flow.edges.find((edge) => edge.to === node.id);
  const outgoing = state.flow.edges.find((edge) => edge.from === node.id);
  state.flow.edges = state.flow.edges.filter((edge) => edge.from !== node.id && edge.to !== node.id);
  if (incoming && outgoing) {
    state.flow.edges.push({
      from: incoming.from,
      to: outgoing.to,
      label: incoming.branchField ? incoming.label : outgoing.label || incoming.label || portalMessage("portal.routesTo", "routes to"),
      branchField: incoming.branchField || "",
    });
  }
  state.flow.nodes = state.flow.nodes.filter((item) => item.id !== node.id);
  finalizeFlowMutation();
}

function deleteSelectedNodes() {
  const ids = new Set(state.selectedNodeIds || []);
  if (ids.size <= 1) {
    deleteSelectedNode();
    return;
  }
  if (!state.flow) return;
  rememberFlowUndo();
  const nodes = (state.flow.nodes || []).filter((node) => ids.has(node.id) && !node.locked);
  const removable = new Set();
  for (const node of nodes) {
    const incomingBranch = node.branchTarget && node.sourceId && node.branchField
      ? { from: node.sourceId, branchField: node.branchField }
      : (state.flow.edges || []).find((edge) => edge.to === node.id && edge.branchField);
    if (incomingBranch) {
      const source = (state.flow.nodes || []).find((item) => item.id === incomingBranch.from);
      if (source) {
        clearBranchConfig(source, incomingBranch.branchField);
        removeBranch(state.flow, source, incomingBranch.branchField);
        continue;
      }
    }
    collectSubtreeNodeIds(state.flow, node.id, removable);
  }
  removeNodeSet(state.flow, removable);
  finalizeFlowMutation();
}

function applyTargetSelection(value) {
  if (!value) return;
  let next;
  try {
    next = JSON.parse(value);
  } catch {
    return;
  }

  const selected = selectedNode();
  const target = selected && !selected.locked
    ? selected
    : (state.flow?.nodes || []).find((node) => node.isTarget) || selected;
  if (!target) return;
  rememberFlowUndo();
  applyTargetToNode(target, next);
  syncBranchSourceConfig(target);
  state.selectedNodeId = target.id;
  state.selectedNodeIds = [];
  state.selectedBranchField = "";
  saveCurrentFlowLayout();
  saveCurrentFlowDraft(false);
  state.flowFeedback = null;
  renderCallflow();
  renderFlowHelper();
  renderFlowFeedback();
}

function applyBulkTargetSelection(value) {
  if (!value || !state.selectedNodeIds?.length) return;
  let next;
  try {
    next = JSON.parse(value);
  } catch {
    return;
  }
  const ids = new Set(state.selectedNodeIds);
  const nodes = (state.flow?.nodes || []).filter((node) => ids.has(node.id) && !node.locked);
  if (!nodes.length) return;
  rememberFlowUndo();
  for (const node of nodes) {
    applyTargetToNode(node, next);
    syncBranchSourceConfig(node);
  }
  materializeBranchNodes(state.flow);
  saveCurrentFlowLayout();
  saveCurrentFlowDraft(false);
  state.flowFeedback = null;
  renderCallflow();
  renderFlowHelper();
  renderFlowFeedback();
}

function formPayload(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function submitAction(form, endpoint, extra = {}, targetView = "changes") {
  const writeContext = state.overview?.settings?.writeContext;
  const previousPlan = state.actionPlan;
  const result = await fetchJson(endpoint, {
    method: "POST", writeContext,
    body: JSON.stringify({ ...formPayload(form), ...extra }),
  });
  if (!isCurrentWriteContext(writeContext) || state.actionPlan !== previousPlan) return;
  state.actionPlan = { ...result, context: targetView, writeContext };
  setView(targetView);
  renderActionPlan();
}

async function stagePhonebookSync() {
  const writeContext = state.overview?.settings?.writeContext;
  const generation = ++phonebookRequestGeneration;
  const ownsOperation = () => generation === phonebookRequestGeneration && isCurrentWriteContext(writeContext);
  state.phonebookSyncLoading = true;
  const hasManualContacts = collectManualPhonebookRows().length > 0;
  state.actionPlan = {
    ok: true,
    type: "phonebook-sync",
    title: portalMessage("portal.preparingComparison", "Preparing comparison"),
    message: hasManualContacts
      ? portalMessage("portal.settingManualContactsAsTheLocalSourceAndComparing", "Setting manual contacts as the local source and comparing them with the NFON phonebook.")
      : portalMessage("portal.comparingTheContactSourceWithTheNfonPhonebookNothing", "Comparing the contact source with the NFON phonebook. Nothing is saved."),
    source: {},
    target: {},
    summary: {},
    actions: [],
    createdAt: new Date().toISOString(),
  };
  let activePlan = state.actionPlan;
  const current = () => state.actionPlan === activePlan && isCurrentWriteContext(writeContext);
  renderPhonebookSync();
  renderActionPlan();

  try {
    if (hasManualContacts) await persistManualPhonebookContacts(writeContext);
    if (!current()) return;
    const result = await fetchJson("/api/phonebook-sync/preview", { method: "POST", writeContext });
    if (!current()) return;
    state.actionPlan = activePlan = { ...result, writeContext };
  } catch (error) {
    if (!current()) return;
    state.actionPlan = activePlan = {
      ok: false,
      type: "phonebook-sync",
      title: portalMessage("portal.phonebookSyncFailed", "Phonebook sync failed"),
      message: error.message,
      source: {},
      target: {},
      summary: {},
      actions: [],
      createdAt: new Date().toISOString(),
    };
  } finally {
    if (ownsOperation()) {
      state.phonebookSyncLoading = false;
      renderPhonebookSync();
      renderActionPlan();
    }
  }
}

async function applyPhonebookSync() {
  if (state.phonebookSyncLoading) return;
  if (state.actionPlan?.type !== "phonebook-sync" || !state.actionPlan.ok || state.actionPlan.applied || state.phonebookManualDirty || !liveApplyPermitted()) return;
  const writeContext = state.actionPlan.writeContext;
  if (!isCurrentWriteContext(writeContext)) return;
  const generation = ++phonebookRequestGeneration;
  const ownsOperation = () => generation === phonebookRequestGeneration && isCurrentWriteContext(writeContext);
  state.phonebookSyncLoading = true;
  state.actionPlan = {
    ...state.actionPlan,
    ok: true,
    title: portalMessage("portal.applyingChanges_84ae9", "Applying changes"),
    message: portalMessage("portal.thePortalApiIsSavingTheIdentifiedPhonebookChanges", "The Portal API is saving the identified phonebook changes."),
  };
  let activePlan = state.actionPlan;
  const current = () => state.actionPlan === activePlan && isCurrentWriteContext(writeContext);
  renderPhonebookSync();
  renderActionPlan();

  try {
    if (!await enableActionWrites(writeContext, current) || !current()) return;
    const result = await fetchJson("/api/phonebook-sync/apply", { method: "POST", writeContext });
    if (!current()) return;
    state.actionPlan = activePlan = { ...result, writeContext };
    await loadOverview();
    if (!current()) return;
    state.actionPlan = activePlan = { ...result, writeContext };
  } catch (error) {
    if (!current()) return;
    state.actionPlan = activePlan = {
      ...state.actionPlan,
      ok: false,
      type: "phonebook-sync",
      title: portalMessage("portal.applyingChangesFailed", "Applying changes failed"),
      message: error.message,
      applied: false,
      createdAt: new Date().toISOString(),
    };
  } finally {
    if (ownsOperation()) {
      state.phonebookSyncLoading = false;
      renderPhonebookSync();
      renderActionPlan();
    }
  }
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function contactsFromCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
}

function normalizeExtensionBatchCsvRow(row) {
  const normalized = {
    extensionNumber: String(row.extensionNumber || row.number || row.nummer || row.Nummer || "").trim(),
    displayName: String(row.displayName || row.name || row.Name || "").trim(),
    mailboxPin: String(row.mailboxPin || row.pin || row.MailboxPin || row.MailboxPIN || row["Mailbox-PIN"] || "").trim(),
  };
  for (const field of selectedExtensionBatchFields()) {
    const aliases = [field.key, field.label, ...(field.aliases || [])];
    const value = aliases.map((alias) => row[alias] ?? row[String(alias).toLowerCase()] ?? row[String(alias).replace(/\s+/g, "")]).find((candidate) => candidate !== undefined && candidate !== "");
    normalized[field.key] = normalizeExtensionBatchFieldValue(value === undefined ? field.defaultValue : value, field);
  }
  return normalized;
}

function parseExtensionBatchCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return normalizeExtensionBatchCsvRow(Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
  }).filter((row) => row.extensionNumber || row.displayName || row.mailboxPin);
}

function setExtensionBatchField(rowElement, field, value) {
  const index = Number(rowElement?.dataset.extensionBatchRow);
  if (!Number.isInteger(index) || !state.extensionBatchRows[index]) return;
  state.extensionBatchRows[index] = {
    ...state.extensionBatchRows[index],
    [field]: value,
  };
  invalidateExtensionBatch();
  $("#apply-extension-batch")?.closest(".batch-result")?.remove();
}

function emptyExtensionBatchRow() {
  const row = {
    extensionNumber: "",
    displayName: "",
    mailboxPin: "",
  };
  for (const field of selectedExtensionBatchFields()) {
    row[field.key] = batchDefaultForField(field);
  }
  return row;
}

function batchDefaultForField(field) {
  if (field.type !== "boolean") return field.defaultValue;
  if (state.extensionBatchRows.length && ["accessCentralPhoneBook", "phoneBookHide"].includes(field.key)) {
    return field.key === "accessCentralPhoneBook"
      ? state.extensionBatchRows.every((row) => row.accessCentralPhoneBook !== false)
      : state.extensionBatchRows.every((row) => row.phoneBookHide === true);
  }
  return field.defaultValue;
}

function updateExtensionBatchSelectedField(fieldKey, selected) {
  const field = EXTENSION_BATCH_FIELD_MAP.get(fieldKey);
  if (!field) return;
  const current = new Set(state.extensionBatchSelectedFields);
  if (selected) current.add(fieldKey);
  else current.delete(fieldKey);
  state.extensionBatchSelectedFields = EXTENSION_BATCH_OPTIONAL_FIELDS
    .filter((definition) => current.has(definition.key))
    .map((definition) => definition.key);
  if (selected) {
    state.extensionBatchRows = state.extensionBatchRows.map((row) => ({
      ...row,
      [field.key]: row[field.key] === undefined ? batchDefaultForField(field) : row[field.key],
    }));
  }
  invalidateExtensionBatch();
}

function focusExtensionBatchRow(index) {
  window.requestAnimationFrame(() => {
    const input = document.querySelector(`[data-extension-batch-row="${index}"] [data-extension-batch-field="extensionNumber"]`);
    input?.focus();
  });
}

function addExtensionBatchRow() {
  state.extensionBatchRows.push(emptyExtensionBatchRow());
  invalidateExtensionBatch();
  renderExtensionBatch();
  focusExtensionBatchRow(state.extensionBatchRows.length - 1);
}

function insertExtensionBatchRowAfter(index) {
  const nextIndex = Math.min(Math.max(Number(index) + 1, 0), state.extensionBatchRows.length);
  state.extensionBatchRows.splice(nextIndex, 0, emptyExtensionBatchRow());
  invalidateExtensionBatch();
  renderExtensionBatch();
  focusExtensionBatchRow(nextIndex);
}

function removeExtensionBatchRow(index) {
  state.extensionBatchRows.splice(index, 1);
  if (!state.extensionBatchRows.length) addExtensionBatchRow();
  invalidateExtensionBatch();
  renderExtensionBatch();
}

async function loadExtensionBatchCsv(file) {
  if (!file) return;
  invalidateExtensionBatch();
  try {
    const rows = parseExtensionBatchCsv(await file.text());
    state.extensionBatchRows = rows.length ? rows : state.extensionBatchRows;
    state.extensionBatchPlan = rows.length ? null : {
      ok: false,
      title: portalMessage("portal.server.csvIsEmpty", "CSV is empty"),
      message: portalMessage("portal.theFileContainsNoUsableExtensions", "The file contains no usable extensions."),
      summary: { total: 0, valid: 0, invalid: 0, existing: 0 },
      entries: [],
    };
  } catch (error) {
    state.extensionBatchPlan = {
      ok: false,
      title: portalMessage("portal.csvNotRead", "CSV not read"),
      message: error.message,
      summary: { total: 0, valid: 0, invalid: 0, existing: 0 },
      entries: [],
    };
  }
  renderExtensionBatch();
}

async function planExtensionBatch() {
  const generation = ++extensionBatchRequestGeneration;
  const writeContext = state.overview?.settings?.writeContext;
  const rows = clone(extensionBatchRows());
  const current = () => generation === extensionBatchRequestGeneration && isCurrentWriteContext(writeContext);
  state.extensionBatchLoading = true;
  state.extensionBatchPlan = {
    ok: false,
    title: portalMessage("portal.checkingBatch", "Checking batch"),
    message: portalMessage("portal.checkingTheListAgainstTheCurrentExtensionInventory", "Checking the list against the current extension inventory."),
    summary: { total: rows.length, valid: 0, invalid: 0, existing: 0 },
    entries: [],
  };
  renderExtensionBatch();
  try {
    const result = await fetchJson("/api/extensions/batch/plan", {
      method: "POST", writeContext,
      body: JSON.stringify({ rows }),
    });
    if (!current()) return;
    state.extensionBatchPlan = { ...result, writeContext, batchRows: rows };
  } catch (error) {
    if (!current()) return;
    state.extensionBatchPlan = {
      ok: false,
      title: portalMessage("portal.batchCheckFailed", "Batch check failed"),
      message: error.message,
      summary: { total: rows.length, valid: 0, invalid: 0, existing: 0 },
      entries: [],
    };
  } finally {
    if (current()) {
      state.extensionBatchLoading = false;
      renderExtensionBatch();
    }
  }
}

async function applyExtensionBatch() {
  if (state.extensionBatchLoading || !state.extensionBatchPlan?.ok || !liveApplyPermitted()) return;
  const preparedPlan = state.extensionBatchPlan;
  const writeContext = preparedPlan.writeContext;
  const rows = clone(preparedPlan.batchRows || []);
  if (!isCurrentWriteContext(writeContext) || JSON.stringify(rows) !== JSON.stringify(extensionBatchRows())) {
    invalidateExtensionBatch();
    renderExtensionBatch();
    return;
  }
  const confirmed = await confirmUi({
    title: portalMessage("portal.applyBatchImport", "Apply batch import"),
    message: portalMessage("portal.theseExtensionsWillBeCreatedInTheLivePortal", "These extensions will be created in the live Portal API. Continue?"),
    confirmLabel: portalMessage("portal.apply", "Apply"),
  });
  if (!confirmed || state.extensionBatchPlan !== preparedPlan || !isCurrentWriteContext(writeContext)
    || JSON.stringify(rows) !== JSON.stringify(extensionBatchRows()) || !liveApplyPermitted()) return;
  const generation = ++extensionBatchRequestGeneration;
  const current = () => generation === extensionBatchRequestGeneration && isCurrentWriteContext(writeContext);
  const progress = showUiProgress({ title: portalMessage("portal.applyingBatchImport", "Applying batch import"), message: portalMessage("portal.thePortalApiIsCreatingTheExtensions", "The Portal API is creating the extensions.") });
  state.extensionBatchLoading = true;
  renderExtensionBatch();
  try {
    const prepared = () => current() && state.extensionBatchPlan === preparedPlan && JSON.stringify(rows) === JSON.stringify(extensionBatchRows());
    if (!await enableActionWrites(writeContext, prepared) || !prepared()) { progress.close(); return; }
    const result = await fetchJson("/api/extensions/batch/apply", {
      method: "POST", writeContext,
      body: JSON.stringify({ rows }),
    });
    if (!current()) return;
    state.extensionBatchPlan = result;
    await loadOverview();
    if (!current()) return;
    state.extensionBatchPlan = result;
    progress.success({ title: portalMessage("portal.batchImportApplied", "Batch import applied"), message: result.message || portalMessage("portal.theExtensionsWereProcessed", "The extensions were processed.") });
  } catch (error) {
    if (!current()) return;
    state.extensionBatchPlan = {
      ...preparedPlan,
      ok: false,
      applied: false,
      title: portalMessage("portal.applyingBatchFailed", "Applying batch failed"),
      message: error.message,
    };
    progress.error({ title: portalMessage("portal.applyingBatchFailed", "Applying batch failed"), message: error.message });
  } finally {
    if (current()) {
      state.extensionBatchLoading = false;
      render();
    }
  }
}

async function uploadPhonebookContacts(form) {
  const file = form.querySelector("#phonebook-upload-file")?.files?.[0];
  if (!file) {
    state.phonebookUploadFeedback = { ok: false, title: portalMessage("portal.uploadMissing", "Upload missing"), message: portalMessage("portal.selectAJsonOrCsvFileFirst", "Select a JSON or CSV file first.") };
    renderPhonebookSync();
    return;
  }
  const writeContext = state.overview?.settings?.writeContext;
  try {
    const text = await file.text();
    if (!isCurrentWriteContext(writeContext)) return;
    let contacts;
    if (file.name.toLowerCase().endsWith(".csv")) {
      contacts = contactsFromCsv(text);
    } else {
      const parsed = JSON.parse(text);
      contacts = Array.isArray(parsed) ? parsed : parsed.contacts;
    }
    const result = await fetchJson("/api/phonebook-sync/upload", {
      method: "POST", writeContext,
      body: JSON.stringify({ contacts, source: file.name, syncedAt: new Date(file.lastModified || Date.now()).toISOString() }),
    });
    if (!isCurrentWriteContext(writeContext)) return;
    if (state.overview) state.overview.settings = result.settings;
    state.phonebookManualRows = [];
    state.phonebookManualDraft = { firstName: "", name: "", phone: "" };
    state.phonebookManualDirty = false;
    state.phonebookUploadFeedback = {
      ok: true,
      title: portalMessage("portal.uploadApplied", "Upload applied"),
      message: portalMessage("portal.valueContactsAreActiveAsTheContactSource", "{p0} contacts are active as the contact source.", { p0: result.contacts, p1: result.contacts === 1 ? "" : "e" }),
    };
    await stagePhonebookSync();
  } catch (error) {
    if (!isCurrentWriteContext(writeContext)) return;
    state.phonebookUploadFeedback = { ok: false, title: portalMessage("portal.server.uploadFailed", "Upload failed"), message: error.message };
    renderPhonebookSync();
  }
}

function selectedProfileTarget(choices = parsedDaynightTargetOptions()) {
  ensureProfileTargetValue(choices);
  const selected = choices.find(({ option }) => option.value === state.profileTargetValue);
  return selected?.target || null;
}

function presentActionPlan(targetView = "changes") {
  if (targetView === "callflow") {
    state.actionPlan.context = "callflow";
    state.flowFeedback = {
      ok: state.actionPlan.ok !== false,
      title: state.actionPlan.title,
      message: state.actionPlan.message,
    };
    renderFlowFeedback();
    renderFlowPlan();
    renderFlowProfileActions();
    return;
  }
  setView("changes");
  renderActionPlan();
}

function saveStandardProfile(targetView = "changes") {
  const snapshot = buildProfileSnapshot(portalMessage("portal.default", "Default"));
  writeProfile("standard", snapshot);
  const account = getOverview()?.account || "portal";
  downloadJsonFile(`nfon-standard-${account}-${safeFileTimestamp(new Date(snapshot.createdAt))}.json`, {
    type: "nfon-portal-standard-profile",
    account,
    exportedAt: new Date().toISOString(),
    profile: snapshot,
  });
  state.actionPlan = {
    ok: true,
    type: "profile",
    context: targetView,
    title: portalMessage("portal.defaultProfileSaved", "Default profile saved"),
    message: portalMessage("portal.valueNumbersSavedAsARestorePointAndDownloaded", "{p0} numbers saved as a restore point and downloaded as JSON.", { p0: snapshot.dids.length, p1: snapshot.dids.length === 1 ? "" : "n" }),
    profileName: portalMessage("portal.default", "Default"),
    changeCount: 0,
    changes: [],
    createdAt: snapshot.createdAt,
  };
  renderChangeAssistant();
  presentActionPlan(targetView);
}

async function importStandardProfileFile(file, targetView = "changes") {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const profile = payload?.profile || payload;
    const currentAccount = profileAccountKey();
    const payloadAccount = payload?.account || profile?.account;
    if (payload?.type && payload.type !== "nfon-portal-standard-profile") {
      throw new Error(portalMessage("portal.theFileIsNotADefaultProfileBackupFrom", "The file is not a default-profile backup from this app."));
    }
    if (!profile || !Array.isArray(profile.dids) || !profile.createdAt) {
      throw new Error(portalMessage("portal.theBackupContainsNoValidDefaultProfile", "The backup contains no valid default profile."));
    }
    if (payloadAccount && payloadAccount !== currentAccount) {
      throw new Error(portalMessage("portal.theBackupBelongsToValueValueIsActive", "The backup belongs to {p0}; {p1} is active.", { p0: payloadAccount, p1: currentAccount }));
    }
    writeProfile("standard", {
      ...profile,
      name: profile.name || portalMessage("portal.default", "Default"),
      account: currentAccount,
    });
    state.actionPlan = {
      ok: true,
      type: "profile",
      context: targetView,
      title: portalMessage("portal.defaultBackupLoaded", "Default backup loaded"),
      message: portalMessage("portal.valueNumbersLoadedFromValueTheRestorationPlanIs", "{p0} numbers loaded from {p2}. The restoration plan is now being checked.", { p0: profile.dids.length, p1: profile.dids.length === 1 ? "" : "n", p2: file.name }),
      profileName: portalMessage("portal.default", "Default"),
      changeCount: 0,
      changes: [],
      createdAt: new Date().toISOString(),
    };
    presentActionPlan(targetView);
    await stageStandardProfile(targetView);
  } catch (error) {
    state.actionPlan = {
      ok: false,
      type: "profile",
      context: targetView,
      title: portalMessage("portal.defaultBackupNotLoaded", "Default backup not loaded"),
      message: error.message,
      profileName: portalMessage("portal.default", "Default"),
      changeCount: 0,
      changes: [],
      createdAt: new Date().toISOString(),
    };
    presentActionPlan(targetView);
  }
}

async function stageProfilePlan(profileName, changes, emptyMessage, targetView = "changes") {
  const writeContext = state.overview?.settings?.writeContext;
  const payload = clone({ profileName, changes, commit: false });
  if (!changes.length) {
    state.actionPlan = {
      ok: true,
      type: "profile",
      context: targetView,
      title: portalMessage("portal.noChangeNeeded", "No change needed"),
      message: emptyMessage,
      profileName,
      changeCount: 0,
      changes: [],
      createdAt: new Date().toISOString(),
    };
    presentActionPlan(targetView);
    return;
  }

  state.actionPlan = {
    ok: true,
    type: "profile",
    context: targetView,
    title: portalMessage("portal.checkingValue", "Checking {p0}", { p0: profileName }),
    message: portalMessage("portal.server.thePortalApiIsPreparingTheTechnicalPreview", "The Portal API is preparing the technical preview."),
    profileName,
    changeCount: changes.length,
    changes: [],
    createdAt: new Date().toISOString(),
  };
  const pendingPlan = state.actionPlan;
  const current = () => state.actionPlan === pendingPlan && isCurrentWriteContext(writeContext);
  presentActionPlan(targetView);

  try {
    const result = await fetchJson("/api/callflow/bulk-apply", {
      method: "POST", writeContext,
      body: JSON.stringify(payload),
    });
    if (!current()) return;
    state.actionPlan = { ...result, context: targetView, writeContext };
  } catch (error) {
    if (!current()) return;
    state.actionPlan = {
      ok: false,
      type: "profile",
      context: targetView,
      title: portalMessage("portal.profileCheckFailed", "Profile check failed"),
      message: error.message,
      profileName,
      changeCount: changes.length,
      changes: [],
      createdAt: new Date().toISOString(),
    };
  }
  presentActionPlan(targetView);
}

async function stageNightProfile(targetView = "changes") {
  const target = selectedProfileTarget();
  if (!target) {
    state.actionPlan = {
      ok: false,
      type: "profile",
      context: targetView,
      title: portalMessage("portal.noNightTargetAvailable", "No night target available"),
      message: portalMessage("portal.noExistingPortalTargetWasFound", "No existing Portal target was found."),
      profileName: portalMessage("portal.nightMode", "Night mode"),
      changeCount: 0,
      changes: [],
      createdAt: new Date().toISOString(),
    };
    presentActionPlan(targetView);
    return;
  }

  await stageProfilePlan(
    portalMessage("portal.nightMode", "Night mode"),
    buildChangesToTarget(target),
    portalMessage("portal.allNumbersAlreadyRouteToTheSelectedNightTarget", "All numbers already route to the selected night target."),
    targetView,
  );
}

async function stageStandardProfile(targetView = "changes") {
  const profile = readProfile("standard");
  if (!profile) {
    state.actionPlan = {
      ok: false,
      type: "profile",
      context: targetView,
      title: portalMessage("portal.noDefaultProfile", "No default profile"),
      message: portalMessage("portal.saveTheCurrentDefaultFirst", "Save the current default first."),
      profileName: portalMessage("portal.default", "Default"),
      changeCount: 0,
      changes: [],
      createdAt: new Date().toISOString(),
    };
    presentActionPlan(targetView);
    return;
  }

  await stageProfilePlan(
    portalMessage("portal.default", "Default"),
    buildChangesFromProfile(profile),
    portalMessage("portal.theCurrentRoutingAlreadyMatchesTheSavedDefault", "The current routing already matches the saved default."),
    targetView,
  );
}

async function previewDaynightGateway(options = {}) {
  const writeContext = state.overview?.settings?.writeContext;
  const nightTarget = clone(selectedProfileTarget());
  if (!options.preserveFeedback) {
    state.daynightOperationFeedback = null;
  }
  state.daynightGatewayLoading = true;
  state.daynightGatewayPreview = {
    readOnly: true,
    title: portalMessage("portal.checkingTimeControlPlan", "Checking time-control plan"),
    message: portalMessage("portal.thePortalApiIsReadOnlyNoChangesAre", "The Portal API is read only. No changes are written."),
    summary: { total: 0, ready: 0, blocked: 0, frontdesk: 0 },
    entries: [],
  };
  let activePreview = state.daynightGatewayPreview;
  const current = () => state.daynightGatewayPreview === activePreview && isCurrentWriteContext(writeContext);
  renderFlowProfileActions();
  renderDaynightGatewayPreview();
  try {
    const result = await fetchJson("/api/daynight/gateway-preview", {
      method: "POST", writeContext,
      body: JSON.stringify({ nightTarget }),
    });
    if (!current()) return;
    state.daynightGatewayPreview = activePreview = { ...result, writeContext, nightTarget };
  } catch (error) {
    if (!current()) return;
    state.daynightGatewayPreview = activePreview = {
      ok: false,
      readOnly: true,
      title: portalMessage("portal.timeControlCheckFailed", "Time-control check failed"),
      message: error.message,
      summary: { total: 0, ready: 0, blocked: 0, frontdesk: 0 },
      entries: [],
      blockers: [error.message],
    };
  } finally {
    if (current()) {
      state.daynightGatewayLoading = false;
      renderFlowProfileActions();
      renderDaynightGatewayPreview();
    }
  }
}

async function applyDaynightGateways(options = {}) {
  if (!state.daynightGatewayPreview?.ok || state.daynightGatewayApplyLoading) return;
  if (!liveApplyPermitted()) {
    state.daynightGatewayPreview = {
      ...state.daynightGatewayPreview,
      ok: false,
      title: portalMessage("portal.liveWritesDisabled", "Live writes disabled"),
      message: liveWritesDisabledText(),
    };
    renderDaynightGatewayPreview();
    return;
  }
  const writeContext = state.daynightGatewayPreview?.writeContext;
  if (!isCurrentWriteContext(writeContext)) return false;
  const preparedPreview = state.daynightGatewayPreview;
  const preparedNightTarget = clone(preparedPreview.nightTarget);
  if (!options.skipConfirm && !await confirmUi({
    title: portalMessage("portal.writingTimeControls_d08ea", "Writing time controls"),
    message: portalMessage("portal.confirmDaynightCreate", "Apply the planned changes?\n{names}", { names: (state.daynightGatewayPreview.entries.map(entry => entry.gateway.name)).join("\n") }),
  })) return false;
  if (state.daynightGatewayPreview !== preparedPreview || !isCurrentWriteContext(writeContext) || !liveApplyPermitted()) return false;
  state.daynightGatewayApplyLoading = true;
  state.daynightGatewayPreview = {
    ...state.daynightGatewayPreview,
    title: portalMessage("portal.writingTimeControls_d08ea", "Writing time controls"),
    message: portalMessage("portal.thePortalApiCreatesMissingTimeControlsAndUpdates", "The Portal API creates missing time controls and updates existing time controls to the night target. Numbers remain unchanged."),
  };
  renderDaynightGatewayPreview();
  try {
    const current = () => isCurrentWriteContext(writeContext);
    if (!await enableActionWrites(writeContext, current) || !current()) return false;
    const result = await fetchJson("/api/daynight/gateways/apply", {
      method: "POST", writeContext,
      body: JSON.stringify({ nightTarget: preparedNightTarget }),
    });
    if (!isCurrentWriteContext(writeContext)) return false;
    state.daynightGatewayPreview = { ...result, writeContext };
    setDaynightOperationFeedback(result, portalMessage("portal.timeControlsWritten", "Time controls written"));
    if (result.ok === false) return false;
    await loadOverview();
    if (!isCurrentWriteContext(writeContext) || state.error) return false;
    await previewDaynightGateway({ preserveFeedback: true });
    return isCurrentWriteContext(writeContext) && daynightActivationReady();
  } catch (error) {
    if (!isCurrentWriteContext(writeContext)) return false;
    await refreshDaynightAfterLiveError(error, portalMessage("portal.creatingTimeControlsFailed", "Creating time controls failed"));
    return false;
  } finally {
    state.daynightGatewayApplyLoading = false;
    renderFlowProfileActions();
    renderDaynightGatewayPreview();
  }
}

async function cleanupDaynightTimeControls() {
  if (!state.daynightGatewayPreview || state.daynightGatewayCleanupLoading) return;
  const count = state.daynightGatewayPreview?.summary?.cleanupCandidates || state.daynightGatewayPreview?.staleTimeControls?.length || 0;
  if (!count) return;
  if (!liveApplyPermitted()) {
    state.daynightGatewayPreview = {
      ...state.daynightGatewayPreview,
      ok: false,
      title: portalMessage("portal.liveWritesDisabled", "Live writes disabled"),
      message: liveWritesDisabledText(),
    };
    renderDaynightGatewayPreview();
    return;
  }
  const writeContext = state.daynightGatewayPreview?.writeContext;
  if (!isCurrentWriteContext(writeContext)) return false;
  const preparedPreview = state.daynightGatewayPreview;
  const preparedNightTarget = clone(preparedPreview.nightTarget);
  if (!await confirmUi({
    title: portalMessage("portal.cleaningUpTimeControls", "Cleaning up time controls"),
    message: portalMessage("portal.confirmDaynightCleanup", "Apply the planned changes?\n{names}", { names: (state.daynightGatewayPreview.staleTimeControls.map(item => item.name)).join("\n") }),
  })) return false;
  if (state.daynightGatewayPreview !== preparedPreview || !isCurrentWriteContext(writeContext) || !liveApplyPermitted()) return false;
  state.daynightGatewayCleanupLoading = true;
  state.daynightGatewayPreview = {
    ...state.daynightGatewayPreview,
    title: portalMessage("portal.cleaningUpTimeControls", "Cleaning up time controls"),
    message: portalMessage("portal.thePortalApiDeletesOnlyOldNightRoutingTime", "The Portal API deletes only old night-routing time controls matching the naming convention."),
  };
  renderDaynightGatewayPreview();
  try {
    const current = () => isCurrentWriteContext(writeContext);
    if (!await enableActionWrites(writeContext, current) || !current()) return false;
    const result = await fetchJson("/api/daynight/time-controls/cleanup", {
      method: "POST", writeContext,
      body: JSON.stringify({ nightTarget: preparedNightTarget }),
    });
    if (!isCurrentWriteContext(writeContext)) return false;
    state.daynightGatewayPreview = { ...result, writeContext };
    setDaynightOperationFeedback(result, portalMessage("portal.timeControlsCleanedUp", "Time controls cleaned up"));
    await loadOverview();
    await previewDaynightGateway({ preserveFeedback: true });
  } catch (error) {
    if (!isCurrentWriteContext(writeContext)) return false;
    await refreshDaynightAfterLiveError(error, portalMessage("portal.cleanupFailed", "Cleanup failed"));
  } finally {
    state.daynightGatewayCleanupLoading = false;
    renderFlowProfileActions();
    renderDaynightGatewayPreview();
  }
}

async function resetDaynightTimeControls(options = {}) {
  if (state.daynightGatewayResetLoading) return false;
  if (!state.daynightGatewayPreview && options.fromHeaderSwitch) {
    await previewDaynightGateway({ preserveFeedback: true });
  }
  if (!state.daynightGatewayPreview) return false;
  const count = state.daynightGatewayPreview?.summary?.gatewaysExisting || 0;
  if (!count) return false;
  if (!portalApplyPermitted()) {
    state.daynightGatewayPreview = {
      ...state.daynightGatewayPreview,
      ok: false,
      title: portalMessage("portal.liveWritesDisabled", "Live writes disabled"),
      message: liveWritesDisabledText(),
    };
    renderDaynightGatewayPreview();
    return false;
  }
  const writeContext = state.daynightGatewayPreview?.writeContext;
  if (!isCurrentWriteContext(writeContext)) return false;
  const preparedPreview = state.daynightGatewayPreview;
  if (!await confirmUi({
    title: portalMessage("portal.resetNightRouting", "Reset night routing"),
    message: portalMessage("portal.confirmDaynightReset", "Restore day targets and delete these time controls?\n{names}", { names: state.daynightGatewayPreview.entries.map(entry => `${entry.did.name} · ${entry.gateway.name}`).join("\n") }),
  })) return false;
  if (state.daynightGatewayPreview !== preparedPreview || !isCurrentWriteContext(writeContext) || !portalApplyPermitted()) return false;
  state.daynightGatewayResetLoading = true;
  state.daynightGatewayPreview = {
    ...state.daynightGatewayPreview,
    title: portalMessage("portal.resettingNightRouting", "Resetting night routing"),
    message: portalMessage("portal.thePortalApiRestoresAffectedNumbersAndThenDeletes", "The Portal API restores affected numbers and then deletes the managed TN time controls."),
  };
  renderDaynightGatewayPreview();
  try {
    const current = () => isCurrentWriteContext(writeContext);
    if (!await enableActionWrites(writeContext, current, { allowNightMode: true }) || !current()) return false;
    const result = await fetchJson("/api/daynight/reset", { method: "POST", writeContext, body: JSON.stringify({}) });
    if (!isCurrentWriteContext(writeContext)) return false;
    state.daynightGatewayPreview = { ...result, writeContext };
    setDaynightOperationFeedback(result, portalMessage("portal.nightRoutingReset", "Night routing reset"));
    if (options.fromHeaderSwitch || state.daynightActive) {
      setDaynightActive(false, "day");
    }
    await loadOverview();
    await previewDaynightGateway({ preserveFeedback: true });
    return true;
  } catch (error) {
    if (!isCurrentWriteContext(writeContext)) return false;
    await refreshDaynightAfterLiveError(error, portalMessage("portal.resetFailed", "Reset failed"));
    return false;
  } finally {
    state.daynightGatewayResetLoading = false;
    renderFlowProfileActions();
    renderDaynightGatewayPreview();
  }
}

async function restoreDaynightRouting(options = {}) {
  if (state.daynightGatewayResetLoading) return false;
  if (!state.daynightGatewayPreview && options.fromHeaderSwitch) {
    await previewDaynightGateway({ preserveFeedback: true });
  }
  if (!portalApplyPermitted()) {
    state.daynightModeModal = {
      mode: "error",
      title: portalMessage("portal.liveWritesDisabled", "Live writes disabled"),
      message: liveWritesDisabledText(),
    };
    renderDaynightModeModal();
    return false;
  }
  if (!state.daynightGatewayPreview?.entries?.length) return false;
  const writeContext = state.daynightGatewayPreview?.writeContext;
  if (!isCurrentWriteContext(writeContext)) return false;
  const preparedPreview = state.daynightGatewayPreview;
  if (!options.skipConfirm && !await confirmUi({
    title: portalMessage("portal.restoreDayMode", "Restore day mode"),
    message: portalMessage("portal.confirmDaynightRestore", "Apply the planned changes?\n{names}", { names: state.daynightGatewayPreview.entries.filter(entry => entry.routingActive).map(entry => entry.did.name).join("\n") }),
  })) return false;
  if (state.daynightGatewayPreview !== preparedPreview || !isCurrentWriteContext(writeContext) || !portalApplyPermitted()) return false;
  state.daynightGatewayResetLoading = true;
  state.daynightModeSwitchLoading = true;
  state.daynightModeModal = {
    mode: "loading",
    title: portalMessage("portal.server.pleaseWait", "Please wait"),
    message: portalMessage("portal.dayModeIsBeingRestoredThePreparedTimeControls", "Day mode is being restored. The prepared time controls are retained."),
    busy: true,
  };
  renderDaynightModeModal();
  updateDaynightHeaderButton();
  try {
    const current = () => isCurrentWriteContext(writeContext);
    if (!await enableActionWrites(writeContext, current, { allowNightMode: true }) || !current()) return false;
    const result = await fetchJson("/api/daynight/restore", { method: "POST", writeContext, body: JSON.stringify({}) });
    if (!isCurrentWriteContext(writeContext)) return false;
    state.daynightGatewayPreview = { ...result, writeContext };
    setDaynightOperationFeedback(result, portalMessage("portal.dayModeActivated", "Day mode activated"));
    if (result.ok !== false) {
      state.daynightActive = false;
      portalStorage.setItem(DAYNIGHT_ACTIVE_STORAGE_KEY, "0");
      state.daynightModeModal = { mode: "day", restoredRoutings: result.restoredRoutings || 0, message: portalMessage("portal.valueNumbersRestored", "Numbers restored: {p0}", { p0: result.restoredRoutings || 0 }) };
    }
    await loadOverview();
    await previewDaynightGateway({ preserveFeedback: true });
    return result.ok !== false;
  } catch (error) {
    if (!isCurrentWriteContext(writeContext)) return false;
    await refreshDaynightAfterLiveError(error, portalMessage("portal.activatingDayModeFailed", "Activating day mode failed"));
    state.daynightModeModal = {
      mode: "error",
      message: error.message || portalMessage("portal.dayModeCouldNotBeRestored", "Day mode could not be restored."),
    };
    return false;
  } finally {
    state.daynightGatewayResetLoading = false;
    state.daynightModeSwitchLoading = false;
    renderFlowProfileActions();
    renderDaynightGatewayPreview();
    renderDaynightModeModal();
    updateDaynightHeaderButton();
  }
}

async function applyDaynightGatewayRouting(options = {}) {
  if (!state.daynightGatewayPreview?.ok || state.daynightGatewayRoutingLoading || state.daynightActive) return false;
  if (!liveApplyPermitted()) {
    state.daynightGatewayPreview = {
      ...state.daynightGatewayPreview,
      ok: false,
      title: portalMessage("portal.liveWritesDisabled", "Live writes disabled"),
      message: liveWritesDisabledText(),
    };
    renderDaynightGatewayPreview();
    return false;
  }
  const writeContext = state.daynightGatewayPreview?.writeContext;
  if (!isCurrentWriteContext(writeContext)) return false;
  const preparedPreview = state.daynightGatewayPreview;
  const preparedNightTarget = clone(preparedPreview.nightTarget);
  if (!options.skipConfirm && !await confirmUi({
    title: portalMessage("portal.activateNightMode_5e185", "Activate night mode"),
    message: portalMessage("portal.confirmNightDestination", "Route these numbers to {target}?\n{names}", { target: selectedProfileTarget()?.title || selectedProfileTarget()?.href || "—", names: state.daynightGatewayPreview.entries.map(entry => entry.did.name).join("\n") }),
  })) return false;
  if (state.daynightGatewayPreview !== preparedPreview || !isCurrentWriteContext(writeContext) || !liveApplyPermitted()) return false;
  state.daynightGatewayRoutingLoading = true;
  if (options.fromHeaderSwitch) {
    state.daynightModeSwitchLoading = true;
    state.daynightModeModal = {
      mode: "loading",
      title: portalMessage("portal.server.pleaseWait", "Please wait"),
      message: portalMessage("portal.nightModeIsBeingActivatedThePortalApiReassigns", "Night mode is being activated. The Portal API reassigns numbers to the prepared time controls."),
      busy: true,
    };
    renderDaynightModeModal();
    updateDaynightHeaderButton();
  }
  state.daynightGatewayPreview = {
    ...state.daynightGatewayPreview,
    title: portalMessage("portal.reassigningNumbers_6e7b0", "Reassigning numbers"),
    message: portalMessage("portal.thePortalApiRemovesThePreviousDidAssignmentsAnd", "The Portal API removes the previous DID assignments and reassigns them to the prepared time controls. A rollback is attempted if an error occurs."),
  };
  renderDaynightGatewayPreview();
  try {
    const current = () => isCurrentWriteContext(writeContext);
    if (!await enableActionWrites(writeContext, current) || !current()) return false;
    const result = await fetchJson("/api/daynight/gateway-routing/apply", {
      method: "POST", writeContext,
      body: JSON.stringify({ nightTarget: preparedNightTarget }),
    });
    if (!isCurrentWriteContext(writeContext)) return false;
    state.daynightGatewayPreview = { ...result, writeContext };
    setDaynightOperationFeedback(result, portalMessage("portal.numbersReassigned", "Numbers reassigned"));
    if (result.ok !== false) {
      setDaynightActive(true, "night");
    }
    await loadOverview();
    return result.ok !== false;
  } catch (error) {
    if (!isCurrentWriteContext(writeContext)) return false;
    await refreshDaynightAfterLiveError(error, portalMessage("portal.numberMigrationFailed", "Number migration failed"));
    return false;
  } finally {
    state.daynightGatewayRoutingLoading = false;
    if (options.fromHeaderSwitch) state.daynightModeSwitchLoading = false;
    renderFlowProfileActions();
    renderDaynightGatewayPreview();
    renderDaynightModeModal();
    updateDaynightHeaderButton();
  }
}

async function prepareAndActivateNightMode() {
  if (state.daynightSetupLoading || state.daynightModeSwitchLoading || state.daynightGatewayApplyLoading || state.daynightGatewayRoutingLoading || state.daynightGatewayResetLoading) return false;
  if (state.daynightActive) return true;
  const writeContext = state.overview?.settings?.writeContext;
  const target = clone(selectedProfileTarget());
  let selectedValue = state.profileTargetValue;
  // Reloaded options include hydrated labels/config; only the destination identity
  // determines whether this is still the selection that started the operation.
  const targetIdentity = (value) => {
    try {
      const item = JSON.parse(value);
      return JSON.stringify([normalizeTargetType(item.type), String(item.routeNumber || item.targetNumber || item.number || item.href || "")]);
    } catch { return value; }
  };
  const current = () => Boolean(writeContext) && isCurrentWriteContext(writeContext) && targetIdentity(state.profileTargetValue) === targetIdentity(selectedValue);
  const fail = () => { throw new Error(state.daynightOperationFeedback?.ok === false
    ? state.daynightOperationFeedback.message
    : state.daynightGatewayPreview?.message || portalMessage("portal.nightSetupFailed", "Night mode setup failed")); };
  state.daynightSetupLoading = true;
  state.daynightModeSwitchLoading = true;
  state.daynightOperationFeedback = null;
  state.daynightModeModal = {
    mode: "loading", busy: true,
    title: portalMessage("portal.settingUpNightMode", "Setting up night mode"),
    message: portalMessage("portal.nightSetupDescription", "Save day routing, prepare time controls and activate night mode."),
  };
  renderDaynightModeModal();
  renderDaynightGatewayPreview();
  try {
    if (!daynightSetupPermitted()) throw new Error(liveWritesDisabledText());
    if (!target) throw new Error(portalMessage("portal.noTargetSelected", "No target selected"));
    if (!current()) return false;
    await loadOverview();
    if (!current()) return false;
    if (state.error) throw new Error(state.error);
    if (state.daynightActive) { state.daynightModeModal = "night"; return true; }
    if (!daynightSetupPermitted()) throw new Error(liveWritesDisabledText());
    if (!portalLiveWritesEnabled()) {
      // The explicit setup click opts this session into its requested live changes.
      const result = await fetchJson("/api/settings/live-writes", { method: "POST", writeContext, body: JSON.stringify({ enabled: true }) });
      if (!current()) return false;
      if (result.ok === false || result.settings?.writeContext !== writeContext) throw new Error(result.message || liveWritesDisabledText());
      state.overview.settings = result.settings;
      if (!portalLiveWritesEnabled()) throw new Error(liveWritesDisabledText());
    }
    if (!readProfile("standard")) writeProfile("standard", buildProfileSnapshot(portalMessage("portal.default", "Default")));

    // A new announcement target is part of the same explicit setup action.
    if (normalizeTargetType(target.type) === "NEW_NIGHT_TARGET") {
      if (state.daynightAnnouncementSource !== "existing") throw new Error(portalMessage("portal.useAnExistingAnnouncementUntilThen", "Use an existing announcement until then."));
      const payload = clone(daynightAnnouncementPayload());
      const plan = await fetchJson("/api/daynight/announcement-target/plan", { method: "POST", writeContext, body: JSON.stringify(payload) });
      if (!current()) return false;
      if (!plan.ok) throw new Error(plan.message || portalMessage("portal.announcementTargetCannotBeChecked", "Announcement target cannot be checked"));
      const result = await fetchJson("/api/daynight/announcement-target/apply", { method: "POST", writeContext, body: JSON.stringify(payload) });
      if (!current()) return false;
      if (result.ok === false || !result.option?.value) throw new Error(result.message || portalMessage("portal.announcementTargetNotCreated", "Announcement target not created"));
      state.profileTargetValue = selectedValue = result.option.value;
      state.daynightUseAnnouncement = false;
      await loadOverview();
      if (!current()) return false;
      if (state.error) throw new Error(state.error);
    }

    await previewDaynightGateway();
    if (!current()) return false;
    if (!state.daynightGatewayPreview?.ok) fail();
    const summary = state.daynightGatewayPreview.summary || {};
    if (summary.gatewaysToCreate || summary.gatewaysToUpdate) {
      const prepared = await applyDaynightGateways({ skipConfirm: true });
      if (!current()) return false;
      if (!prepared) fail();
    }
    if (!daynightActivationReady()) fail();
    const activated = await applyDaynightGatewayRouting({ skipConfirm: true });
    if (!current()) return false;
    if (!activated) fail();
    return true;
  } catch (error) {
    if (!current()) return false;
    state.daynightModeModal = {
      mode: "error", title: portalMessage("portal.nightSetupFailed", "Night mode setup failed"), message: error.message,
    };
    return false;
  } finally {
    state.daynightSetupLoading = false;
    state.daynightModeSwitchLoading = false;
    if (!current() && state.daynightModeModal?.busy) state.daynightModeModal = null;
    renderFlowProfileActions();
    renderDaynightGatewayPreview();
    renderDaynightModeModal();
    updateDaynightHeaderButton();
  }
}

async function toggleDaynightMode(nextActive) {
  if (state.daynightSetupLoading || state.daynightModeSwitchLoading) return;
  if (nextActive === state.daynightActive) {
    updateDaynightHeaderButton();
    return;
  }
  if (!portalApplyPermitted()) {
    state.daynightModeModal = {
      mode: "setup",
      title: portalMessage("portal.liveWritesDisabled", "Live writes disabled"),
      message: liveWritesDisabledText(),
    };
    renderDaynightModeModal();
    updateDaynightHeaderButton();
    return;
  }
  if (nextActive) {
    if (!daynightActivationReady()) {
      state.daynightModeSwitchLoading = true;
      state.daynightModeModal = {
        mode: "loading",
        title: portalMessage("portal.server.pleaseWait", "Please wait"),
        message: portalMessage("portal.checkingWhetherNightRoutingIsFullyPrepared", "Checking whether night routing is fully prepared."),
        busy: true,
      };
      renderDaynightModeModal();
      updateDaynightHeaderButton();
      try {
        await previewDaynightGateway({ preserveFeedback: true });
      } finally {
        state.daynightModeSwitchLoading = false;
      }
    }
    if (!daynightActivationReady()) {
      state.daynightModeModal = {
        mode: "setup",
        message: portalMessage("portal.nightSetupDescription", "Save day routing, prepare time controls and activate night mode."),
        actions: [
          { action: "close", label: portalMessage("portal.cancel", "Cancel") },
          { action: "prepare-night", label: portalMessage("portal.setUpAndActivateNightMode", "Set up and activate night mode"), kind: "primary" },
        ],
      };
      renderDaynightModeModal();
      updateDaynightHeaderButton();
      return;
    }
    state.daynightModeModal = {
      mode: "confirm-night",
      symbol: "N",
      title: portalMessage("portal.activateNightMode", "Activate night mode?"),
      message: portalMessage("portal.numbersWillBeReassignedToThePreparedTimeControls", "Numbers will be reassigned to the prepared time controls. Live changes in the app will then be locked."),
      actions: [
        { action: "close", label: portalMessage("portal.cancel", "Cancel") },
        { action: "activate-night", label: portalMessage("portal.activateNightMode_5e185", "Activate night mode"), kind: "primary" },
      ],
    };
    renderDaynightModeModal();
  } else {
    state.daynightModeModal = {
      mode: "confirm-day",
      symbol: "T",
      title: portalMessage("portal.activateDayMode", "Activate day mode?"),
      message: portalMessage("portal.numbersWillBeRestoredToTheirSavedDayTargets", "Numbers will be restored to their saved day targets. Prepared time controls remain available for the next night mode."),
      actions: [
        { action: "close", label: portalMessage("portal.cancel", "Cancel") },
        { action: "activate-day", label: portalMessage("portal.activateDayMode_b0e48", "Activate day mode"), kind: "primary" },
      ],
    };
    renderDaynightModeModal();
  }
  updateDaynightHeaderButton();
}

function daynightAnnouncementPayload() {
  return {
    announcementName: state.daynightAnnouncementName || selectedAnnouncementName(),
    afterTarget: parseTargetField(state.daynightAnnouncementAfterValue || selectedAnnouncementAfterValue()),
    displayName: daynightAnnouncementDisplayName(state.daynightAnnouncementName || selectedAnnouncementName()),
  };
}

async function planDaynightAnnouncementTarget() {
  state.daynightAnnouncementLoading = true;
  renderDaynightGatewayPreview();
  try {
    const result = await fetchJson("/api/daynight/announcement-target/plan", {
      method: "POST",
      body: JSON.stringify(daynightAnnouncementPayload()),
    });
    state.daynightGatewayPreview = {
      ...(state.daynightGatewayPreview || {}),
      ...result,
      ok: result.ok,
      title: result.title,
      message: result.message,
      blockers: result.blockers || [],
    };
  } catch (error) {
    state.daynightGatewayPreview = {
      ...(state.daynightGatewayPreview || {}),
      ok: false,
      title: portalMessage("portal.announcementTargetCannotBeChecked", "Announcement target cannot be checked"),
      message: error.message,
      blockers: [error.message],
    };
  } finally {
    state.daynightAnnouncementLoading = false;
    renderDaynightGatewayPreview();
  }
}

async function applyDaynightAnnouncementTarget() {
  if (!liveApplyPermitted()) return;
  const payload = daynightAnnouncementPayload();
  const writeContext = state.overview?.settings?.writeContext;
  const confirmed = await confirmUi({
    title: portalMessage("portal.createAnnouncementTarget", "Create announcement target"),
    message: portalMessage("portal.createAnnouncementTargetValueAsALiveVoiceDialog", "Create announcement target \"{p0}\" as a live voice dialog? Numbers and time controls remain unchanged.", { p0: payload.displayName }),
    confirmLabel: portalMessage("portal.create", "Create"),
  });
  if (!confirmed || !isCurrentWriteContext(writeContext) || !liveApplyPermitted()) return;
  const progress = showUiProgress({ title: portalMessage("portal.creatingAnnouncementTarget", "Creating announcement target"), message: portalMessage("portal.server.thePortalApiIsCreatingTheVoiceDialog", "The Portal API is creating the voice dialog.") });
  state.daynightAnnouncementLoading = true;
  renderDaynightGatewayPreview();
  try {
    const current = () => isCurrentWriteContext(writeContext);
    if (!await enableActionWrites(writeContext, current) || !current()) { progress.close(); return; }
    const result = await fetchJson("/api/daynight/announcement-target/apply", {
      method: "POST", writeContext,
      body: JSON.stringify(payload),
    });
    if (!isCurrentWriteContext(writeContext)) return;
    if (result.option?.value) {
      state.profileTargetValue = result.option.value;
      state.daynightGatewayPreview = null;
      state.daynightUseAnnouncement = false;
    }
    await loadOverview();
    if (!isCurrentWriteContext(writeContext)) return;
    progress.success({ title: portalMessage("portal.announcementTargetCreated", "Announcement target created"), message: portalMessage("portal.theNewNightTargetWasCreatedLive", "The new night target was created live.") });
  } catch (error) {
    if (!isCurrentWriteContext(writeContext)) return;
    state.daynightGatewayPreview = {
      ...(state.daynightGatewayPreview || {}),
      ok: false,
      title: portalMessage("portal.announcementTargetNotCreated", "Announcement target not created"),
      message: error.message,
      blockers: [error.message],
    };
    progress.error({ title: portalMessage("portal.announcementTargetNotCreated", "Announcement target not created"), message: error.message });
  } finally {
    if (isCurrentWriteContext(writeContext)) {
      state.daynightAnnouncementLoading = false;
      renderFlowProfileActions();
      renderDaynightGatewayPreview();
    }
  }
}

async function applyFlowPlan() {
  if (state.flowApplying || !state.actionPlan?.applyPayload) return;
  const preparedPlan = state.actionPlan;
  const preparedPayload = clone(preparedPlan.applyPayload);
  const preparedMemberships = clone(flowMembershipChanges(preparedPayload.flow));
  const preparedWriteContext = preparedPlan.writeContext ?? state.overview?.settings?.writeContext;
  const current = () => state.actionPlan === preparedPlan && isCurrentWriteContext(preparedWriteContext);
  state.actionPlan.applyAttempted = true;
  if (!localApplyPermitted()) {
    const context = state.actionPlan.context || state.view;
    state.actionPlan = {
      ...state.actionPlan,
      ok: false,
      blocked: true,
      title: portalMessage("portal.liveWritesDisabled", "Live writes disabled"),
      message: liveWritesDisabledText(),
      applied: false,
      applyAttempted: true,
    };
    if (context === "callflow") {
      renderFlowFeedback();
      renderFlowPlan();
    } else {
      renderActionPlan();
    }
    return;
  }
  state.flowApplying = true;
  const confirmed = await confirmUi({
    title: portalMessage("portal.applyCallflow", "Apply callflow"),
    message: STATIC_DEMO_MODE ? portalMessage("portal.demo.localApplyAvailable", "Changes can be applied locally in the demo PBX.") : portalMessage("portal.thisChangeWillBeSentToTheLivePortal", "This change will be sent to the live Portal API. Continue?"),
    confirmLabel: "OK",
  });
  if (!confirmed || !current() || !localApplyPermitted()) { state.flowApplying = false; return; }
  const progress = showUiProgress({ title: portalMessage("portal.applyingCallflow", "Applying callflow"), message: (STATIC_DEMO_MODE ? portalMessage("portal.demo.applyingFlow", "Applying callflow locally.") : portalMessage("portal.thePortalApiIsWritingTheChange", "The Portal API is writing the change.")) });
  const context = state.actionPlan.context || state.view;
  const directApply = Boolean(state.actionPlan.directApply);
  const applyAttempted = Boolean(state.actionPlan.applyAttempted);
  const pendingFlow = clone(state.actionPlan.applyPayload?.flow || state.actionPlan.flow || state.flow || {});
  const pendingDid = selectedDid();
  let membershipsApplied = false;

  try {
    if (!localWritesEnabled()) {
      // The existing Apply confirmation also authorizes this session's live writes.
      const result = await fetchJson("/api/settings/live-writes", {
        method: "POST", writeContext: preparedWriteContext, body: JSON.stringify({ enabled: true }),
      });
      if (!current() || !localApplyPermitted()) { progress.close(); return; }
      if (result.ok === false || result.settings?.writeContext !== preparedWriteContext) throw new Error(result.message || liveWritesDisabledText());
      state.overview.settings = result.settings;
      if (!localWritesEnabled()) throw new Error(liveWritesDisabledText());
    }
    state.actionPlan = {
      ...state.actionPlan,
      title: portalMessage("portal.applyingCallflow", "Applying callflow"),
      message: (STATIC_DEMO_MODE ? portalMessage("portal.demo.applyingFlow", "Applying callflow locally.") : portalMessage("portal.thePortalApiIsWritingTheChange", "The Portal API is writing the change.")),
      applyAttempted: true,
    };
    if (context === "callflow") {
      renderFlowFeedback();
      renderFlowPlan();
    } else {
      renderActionPlan();
    }

    if (preparedMemberships.services.length) {
      try {
        const membershipResult = await fetchJson("/api/service-groups/apply", {
          method: "POST", writeContext: preparedWriteContext, body: JSON.stringify(preparedMemberships),
        });
        if (!isCurrentWriteContext(preparedWriteContext)) { progress.close(); return; }
        if (membershipResult.ok === false) throw new Error(membershipResult.error || membershipResult.message);
        recordFlowMembershipReadback(membershipResult.serviceGroups, preparedMemberships.services);
        membershipsApplied = true;
      } catch (error) {
        if (error.body?.completed?.length && isCurrentWriteContext(preparedWriteContext)) {
          error.message = `${error.message} ${portalMessage("portal.partialMembership", "Completed: {done}. Failed: {failed}. Not attempted: {pending}.", { done: error.body.completed.length, failed: 1, pending: error.body.notAttempted?.length || 0 })}`;
          try {
            const groups = await fetchJson("/api/service-groups");
            if (isCurrentWriteContext(preparedWriteContext)) recordFlowMembershipReadback(groups, preparedMemberships.services);
          } catch (readbackError) {
            error.message = `${error.message} ${readbackError.message}`;
          }
        }
        throw error;
      }
    }
    const result = await fetchJson("/api/callflow/apply", {
      method: "POST",
      writeContext: preparedWriteContext,
      body: JSON.stringify({ ...preparedPayload, commit: true }),
    });
    if (result.ok === false || result.applied === false) {
      if (membershipsApplied) result.message = `${portalMessage("portal.server.membershipsApplied", "Memberships applied")}. ${result.message || ""}`;
      state.actionPlan = { ...result, context, directApply, applyAttempted };
      if (context === "callflow") {
        state.flowFeedback = {
          ok: false,
          title: result.title || portalMessage("portal.applyingChangesFailed", "Applying changes failed"),
          message: result.message || portalMessage("portal.thePortalApiDidNotAcceptTheChange", "The Portal API did not accept the change."),
        };
        renderFlowFeedback();
        renderFlowPlan();
      } else {
        renderActionPlan();
      }
      progress.error({ title: result.title || portalMessage("portal.applyingChangesFailed", "Applying changes failed"), message: result.message || portalMessage("portal.thePortalApiDidNotAcceptTheChange", "The Portal API did not accept the change.") });
      return;
    }
    saveAppliedFlowSnapshot(result.flow || pendingFlow, result, pendingDid);
    clearCurrentFlowDraft();
    state.actionPlan = { ...result, context, directApply, applyAttempted };
    await loadOverview();
    if ((pendingFlow.nodes || []).some(node => ["QUEUE", "GROUP", "SKILL"].includes(normalizeTargetType(node.type)) && node.config?.portalMode === "new")) {
      await loadServiceGroups({ quiet: true });
    }
    const expectedNoop = isExpectedNoopFlowResult(result);
    state.actionPlan = context === "callflow" && (expectedNoop || directApply) ? null : { ...result, context };
    if (context === "callflow") {
      state.view = "callflow";
      state.flowFeedback = expectedNoop ? null : {
        ok: result.ok !== false,
        title: portalMessage("portal.callflowApplied", "Callflow applied"),
        message: result.message || portalMessage("portal.theChangeWasSentToThePortalApi", "The change was sent to the Portal API."),
      };
      render();
    } else {
      setView("changes");
      renderActionPlan();
    }
    progress.success({ title: portalMessage("portal.callflowApplied", "Callflow applied"), message: result.message || portalMessage("portal.theChangeWasSentToThePortalApi", "The change was sent to the Portal API.") });
  } catch (error) {
    state.actionPlan = {
      ...state.actionPlan,
      ok: false,
      context,
      title: portalMessage("portal.applyingChangesFailed", "Applying changes failed"),
      message: membershipsApplied ? `${portalMessage("portal.server.membershipsApplied", "Memberships applied")}. ${error.message}` : error.message,
      membershipOperations: error.body?.completed ? error.body : undefined,
      applied: false,
    };
    if (context === "callflow") {
      renderFlowFeedback();
      renderFlowPlan();
    } else {
      renderActionPlan();
    }
    progress.error({ title: portalMessage("portal.applyingChangesFailed", "Applying changes failed"), message: state.actionPlan.message });
  } finally {
    state.flowApplying = false;
  }
}

function isExpectedNoopFlowResult(result) {
  const title = String(result?.title || "").toLowerCase();
  const message = String(result?.message || "").toLowerCase();
  return title.includes("keine routing-aenderung")
    || title.includes("keine routing-änderung")
    || message.includes("bereits mit diesem ziel verbunden");
}

async function applyProfilePlan() {
  if (!state.actionPlan?.applyPayload?.changes?.length) return;
  const preparedPlan = state.actionPlan;
  const preparedPayload = clone(preparedPlan.applyPayload);
  const writeContext = preparedPlan.writeContext;
  if (!isCurrentWriteContext(writeContext)) return;
  if (!liveApplyPermitted()) {
    const context = state.actionPlan.context || state.view;
    state.actionPlan = {
      ...state.actionPlan,
      ok: false,
      blocked: true,
      title: portalMessage("portal.liveWritesDisabled", "Live writes disabled"),
      message: liveWritesDisabledText(),
      applied: false,
    };
    if (context === "callflow") {
      renderFlowFeedback();
      renderFlowPlan();
    } else {
      renderActionPlan();
    }
    return;
  }
  const confirmed = await confirmUi({
    title: portalMessage("portal.applyProfile", "Apply profile"),
    message: portalMessage("portal.thisProfileWillBeAppliedLiveToMultipleNumbers", "This profile will be applied live to multiple numbers. Continue?"),
    confirmLabel: portalMessage("portal.apply", "Apply"),
  });
  if (!confirmed || state.actionPlan !== preparedPlan || !isCurrentWriteContext(writeContext) || !liveApplyPermitted()) return;
  const progress = showUiProgress({ title: portalMessage("portal.applyingProfile", "Applying profile"), message: portalMessage("portal.thePortalApiIsWritingTheRoutingChangesOne", "The Portal API is writing the routing changes one by one.") });
  const context = preparedPlan.context || state.view;
  let activePlan = preparedPlan;
  const current = () => state.actionPlan === activePlan && isCurrentWriteContext(writeContext);

  try {
    if (!await enableActionWrites(writeContext, current) || !current()) { progress.close(); return; }
    const pendingPlan = state.actionPlan;
    state.actionPlan = activePlan = {
      ...state.actionPlan,
      title: portalMessage("portal.applyingValue", "Applying {p0}", { p0: pendingPlan.profileName || "Profil" }),
      message: portalMessage("portal.thePortalApiIsWritingTheRoutingChangesOne", "The Portal API is writing the routing changes one by one."),
    };
    if (context === "callflow") {
      renderFlowFeedback();
      renderFlowPlan();
    } else {
      renderActionPlan();
    }

    const result = await fetchJson("/api/callflow/bulk-apply", {
      method: "POST", writeContext,
      body: JSON.stringify({ ...preparedPayload, commit: true }),
    });
    if (!current()) return;
    state.actionPlan = activePlan = { ...result, context };
    await loadOverview();
    if (!current()) return;
    state.actionPlan = activePlan = { ...result, context };
    if (context === "callflow") {
      state.view = "callflow";
      render();
    } else {
      setView("changes");
      renderActionPlan();
    }
    if (result.ok === false || result.applied === false) {
      progress.error({ title: result.title || portalMessage("portal.applyingProfileFailed", "Applying profile failed"), message: result.message });
      return;
    }
    progress.success({ title: result.title || portalMessage("portal.profileApplied", "Profile applied"), message: result.message || portalMessage("portal.theChangesWereProcessed", "The changes were processed.") });
  } catch (error) {
    if (!current()) return;
    state.actionPlan = {
      ...state.actionPlan,
      ok: false,
      context,
      title: portalMessage("portal.applyingProfileFailed", "Applying profile failed"),
      message: error.message,
      applied: false,
    };
    if (context === "callflow") {
      renderFlowFeedback();
      renderFlowPlan();
    } else {
      renderActionPlan();
    }
    progress.error({ title: portalMessage("portal.applyingProfileFailed", "Applying profile failed"), message: error.message });
  }
}

function handleViewNavigation(target) {
  const viewButton = target.closest?.("[data-view]");
  if (viewButton) {
    setView(viewButton.dataset.view);
    return true;
  }

  const shortcut = target.closest?.("[data-view-shortcut]");
  if (shortcut) {
    setView(shortcut.dataset.viewShortcut);
    return true;
  }

  return false;
}

function bindStaticNavigation() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    if (button.dataset.navBound === "1") return;
    button.dataset.navBound = "1";
    const navigate = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      setView(button.dataset.view);
    };
    button.addEventListener("click", navigate);

  });
}

document.addEventListener("click", (event) => {
  if (event.target.closest?.("#undo-flow-change")) { undoFlowChange(); return; }
  if (handleViewNavigation(event.target)) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-app-dialog-confirm]")) {
    closeUiDialog(true);
    return;
  }

  if (event.target.closest("[data-app-dialog-cancel]")) {
    if (!uiDialog.pending) closeUiDialog(false);
    return;
  }

  if (event.target.closest("#stage-phonebook-sync")) {
    stagePhonebookSync();
    return;
  }

  if (event.target.closest("#apply-phonebook-sync-live")) {
    applyPhonebookSync();
    return;
  }

  if (event.target.closest("#add-phonebook-manual-contact")) {
    addManualPhonebookContact();
    return;
  }

  const authModeButton = event.target.closest("[data-auth-login-mode]");
  if (authModeButton) {
    state.authLoginMode = authModeButton.dataset.authLoginMode === "browser" ? "browser" : "env";
    state.browserLoginFeedback = null;
    renderAuthLoginPanel();
    return;
  }

  if (event.target.closest("#phonebook-format-help-toggle")) {
    state.phonebookFormatHelpOpen = !state.phonebookFormatHelpOpen;
    renderPhonebookSync();
    return;
  }

  const manualPhonebookRemove = event.target.closest("[data-phonebook-manual-remove]");
  if (manualPhonebookRemove) {
    removeManualPhonebookContact(Number(manualPhonebookRemove.dataset.phonebookManualRemove));
    return;
  }

  const extensionSection = event.target.closest("[data-extension-section]");
  if (extensionSection) {
    state.extensionSection = extensionSection.dataset.extensionSection || "overview";
    renderView();
    return;
  }

  const extensionActionMode = event.target.closest("[data-extension-action-mode]");
  if (extensionActionMode) {
    state.extensionActionMode = extensionActionMode.dataset.extensionActionMode === "create" ? "create" : "clone";
    renderExtensionActions();
    return;
  }

  if (event.target.closest("#add-extension-batch-row")) {
    addExtensionBatchRow();
    return;
  }

  if (event.target.closest("#plan-extension-batch")) {
    planExtensionBatch();
    return;
  }

  if (event.target.closest("#apply-extension-batch")) {
    applyExtensionBatch();
    return;
  }

  if (event.target.closest("#toggle-extension-batch-fields")) {
    state.extensionBatchOptionalOpen = true;
    renderExtensionBatch();
    return;
  }

  if (event.target.closest("#close-extension-batch-fields")) {
    state.extensionBatchOptionalOpen = false;
    renderExtensionBatch();
    return;
  }

  const removeBatchRow = event.target.closest("[data-remove-extension-batch-row]");
  if (removeBatchRow) {
    removeExtensionBatchRow(Number(removeBatchRow.dataset.removeExtensionBatchRow));
    return;
  }

  if (event.target.closest("[data-close-resource-modal]")) {
    closeResourceModal();
    return;
  }

  const resourceMetric = event.target.closest("[data-resource-kind]");
  if (resourceMetric) {
    openResourceModal(resourceMetric.dataset.resourceKind);
    return;
  }

  const resourceCreateOpen = event.target.closest("[data-open-resource-create]");
  if (resourceCreateOpen) {
    openResourceCreateModal(resourceCreateOpen.dataset.openResourceCreate);
    return;
  }

  if (event.target.closest("[data-close-resource-create]")) {
    closeResourceCreateModal();
    return;
  }

  const resourceDelete = event.target.closest("[data-delete-resource-kind][data-delete-resource-id]");
  if (resourceDelete) {
    deleteResource(resourceDelete.dataset.deleteResourceKind, resourceDelete.dataset.deleteResourceId);
    return;
  }

  const actionShortcut = event.target.closest("[data-action-shortcut]");
  if (actionShortcut) {
    setView("extensions");
    return;
  }

  const extensionButton = event.target.closest("[data-extension-id]");
  if (extensionButton) {
    state.selectedExtensionId = extensionButton.dataset.extensionId;
    renderExtensionSummary();
    renderExtensions();
    renderExtensionDetail();
    renderExtensionActions();
    renderChangeAssistant();
    return;
  }

  const didSelector = event.target.closest("#flow-did-selector");
  if (didSelector) {
    const menu = $("#flow-did-menu");
    if (menu) {
      const nextHidden = !menu.hidden;
      menu.hidden = nextHidden;
      didSelector.setAttribute("aria-expanded", String(!nextHidden));
      if (!nextHidden) fitFlowDidMenu();
    }
    return;
  }

  const didButton = event.target.closest("[data-did-id]");
  if (didButton) {
    state.selectedDidId = didButton.dataset.didId;
    const baseFlow = applyStoredFlowLayout(buildFlowForDid(selectedDid(), getOverview()), selectedDid());
    flowTextUndo = null;
    state.flow = applyStoredFlowDraft(applyStoredAppliedFlow(baseFlow, selectedDid()), selectedDid());
    state.selectedNodeId = "";
    state.selectedNodeIds = [];
    state.inspectorOpen = false;
    state.selectedBranchField = "";
    state.actionPlan = null;
    state.flowFeedback = null;
    renderDidList();
    renderCallflow();
    renderFlowHelper();
    renderFlowFeedback();
    renderFlowPlan();
    renderView();
    return;
  }

  const insertButton = event.target.closest("[data-insert-from][data-insert-to]");
  if (insertButton) {
    addFlowNode(insertButton.dataset.insertFrom, insertButton.dataset.insertTo);
    return;
  }

  if (event.target.closest("#close-flow-helper")) {
    state.inspectorOpen = false;
    state.selectedNodeId = "";
    state.selectedNodeIds = [];
    state.selectedBranchField = "";
    renderCallflow();
    renderFlowHelper();
    renderView();
    return;
  }

  const editButton = event.target.closest("[data-node-edit]");
  if (editButton) {
    const node = (state.flow?.nodes || []).find((item) => item.id === editButton.dataset.nodeEdit);
    if (!node) return;
    state.selectedNodeId = node.id;
    state.selectedNodeIds = [];
    state.selectedBranchField = "";
    state.inspectorOpen = true;
    renderCallflow();
    renderFlowHelper();
    renderView();
    return;
  }

  const deleteNodeButton = event.target.closest("[data-node-delete]");
  if (deleteNodeButton) {
    const node = (state.flow?.nodes || []).find((item) => item.id === deleteNodeButton.dataset.nodeDelete)
      || visibleFlowNodeById(deleteNodeButton.dataset.nodeDelete);
    if (!node) return;
    state.selectedNodeId = node.id;
    state.selectedNodeIds = [];
    state.selectedBranchField = "";
    deleteSelectedNode();
    return;
  }

  const addIvrKeyButton = event.target.closest("[data-add-ivr-key]");
  if (addIvrKeyButton) {
    addIvrKey(addIvrKeyButton.dataset.addIvrKey);
    return;
  }

  const memberToggle = event.target.closest("[data-node-members-toggle]");
  if (memberToggle) {
    event.preventDefault();
    event.stopPropagation();
    toggleServiceNodeMembers(memberToggle.dataset.nodeMembersToggle);
    return;
  }

  const branchButton = event.target.closest("[data-branch-source]");
  if (branchButton) {
    state.selectedNodeId = branchButton.dataset.branchSource;
    state.selectedNodeIds = [];
    state.selectedBranchField = branchButton.dataset.branchField || "";
    state.inspectorOpen = true;
    renderCallflow();
    renderFlowHelper();
    renderView();
    return;
  }

  const dockButton = event.target.closest("[data-node-dock]");
  if (dockButton && event.detail === 0) {
    event.preventDefault();
    openNodeConnectionSelector(dockButton.dataset.nodeDock);
    return;
  }

  const nodeButton = event.target.closest("[data-node-id]");
  if (nodeButton) {
    state.selectedNodeId = nodeButton.dataset.nodeId;
    state.selectedNodeIds = [];
    state.selectedBranchField = "";
    state.inspectorOpen = false;
    renderCallflow();
    renderFlowHelper();
    renderView();
    return;
  }

  if (event.target.closest("#callflow-canvas") && state.view === "callflow") {
    if (suppressCanvasClick) {
      suppressCanvasClick = false;
      return;
    }
    if (state.selectedNodeId || state.selectedNodeIds.length || state.inspectorOpen) {
      state.selectedNodeId = "";
      state.selectedNodeIds = [];
      state.selectedBranchField = "";
      state.inspectorOpen = false;
      renderCallflow();
      renderFlowHelper();
      renderView();
    }
    return;
  }

  if (event.target.closest("#refresh-button")) {
    loadOverview();
    return;
  }

  if (event.target.closest("#export-flow-pdf")) {
    exportFlowPdf();
    return;
  }

  const flowMenuButton = event.target.closest("[data-flow-menu]");
  if (flowMenuButton) {
    state.activeFlowMenu = flowMenuButton.dataset.flowMenu || "dids";
    state.railOpen = true;
    renderView();
    window.requestAnimationFrame(() => {
      $('[data-flow-menu-content="' + state.activeFlowMenu + '"] input, [data-flow-menu-content="' + state.activeFlowMenu + '"] button')?.focus();
    });
    return;
  }

  if (event.target.closest("#toggle-did-rail")) {
    state.railOpen = false;
    renderView();
    return;
  }

  if (event.target.closest("#delete-flow-node")) {
    deleteSelectedNode();
    return;
  }

  if (event.target.closest("#delete-selected-nodes")) {
    deleteSelectedNodes();
    return;
  }

  if (event.target.closest("#stage-flow")) {
    stageAndApplyFlowPlan();
    return;
  }

  if (event.target.closest("#save-flow-draft-from-plan")) {
    saveCurrentFlowDraft(true);
    renderFlowPlan();
    return;
  }

  if (event.target.closest("#clear-flow-draft")) {
    clearCurrentFlowDraft();
    reloadCurrentFlowWithoutDraft();
    renderDidList();
    renderCallflow();
    renderFlowHelper();
    renderFlowFeedback();
    renderFlowPlan();
    renderView();
    return;
  }

  if (event.target.closest("#restore-previous-flow-draft")) {
    restorePreviousFlowDraft();
    renderCallflow();
    renderView();
    return;
  }

  if (event.target.closest("#close-flow-plan")) {
    state.actionPlan = null;
    renderFlowPlan();
    renderFlowFeedback();
    return;
  }

  if (event.target.closest("[data-branch-back]")) {
    state.selectedBranchField = "";
    state.inspectorOpen = true;
    renderCallflow();
    renderFlowHelper();
    renderView();
    return;
  }

  if (event.target.closest("#zoom-out")) {
    setFlowZoom((state.flowZoom || 1) - 0.1);
    return;
  }

  if (event.target.closest("#zoom-in")) {
    setFlowZoom((state.flowZoom || 1) + 0.1);
    return;
  }

  if (event.target.closest("#apply-flow-live")) {
    applyFlowPlan();
    return;
  }

  if (event.target.closest("#save-standard-profile")) {
    saveStandardProfile();
    return;
  }

  if (event.target.closest("#save-standard-flow-profile")) {
    saveStandardProfile(state.view === "callflow" ? "callflow" : "changes");
    return;
  }

  if (event.target.closest("#stage-night-profile")) {
    stageNightProfile();
    return;
  }

  if (event.target.closest("#stage-night-flow-profile")) {
    if (daynightRequiresDialogCreation()) {
      $("#daynight-gateway-preview")?.scrollIntoView({ behavior: "smooth", block: "start" });
      renderDaynightGatewayPreview();
      return;
    }
    previewDaynightGateway();
    return;
  }

  if (event.target.closest("#stage-standard-profile")) {
    stageStandardProfile();
    return;
  }

  if (event.target.closest("#stage-standard-flow-profile")) {
    $("#standard-flow-import-file")?.click();
    return;
  }

  const daynightModalAction = event.target.closest("[data-daynight-mode-action]")?.dataset.daynightModeAction;
  if (daynightModalAction) {
    if (daynightModalAction === "close") {
      closeDaynightModeModal();
      updateDaynightHeaderButton();
      return;
    }
    if (daynightModalAction === "activate-night") {
      applyDaynightGatewayRouting({ fromHeaderSwitch: true, skipConfirm: true });
      return;
    }
    if (daynightModalAction === "activate-day") {
      restoreDaynightRouting({ fromHeaderSwitch: true, skipConfirm: true });
      return;
    }
    if (daynightModalAction === "prepare-night") {
      prepareAndActivateNightMode();
      return;
    }
  }

  if (event.target.closest("[data-daynight-mode-close]")) {
    if (typeof state.daynightModeModal === "object" && state.daynightModeModal?.busy) return;
    closeDaynightModeModal();
    updateDaynightHeaderButton();
    return;
  }

  if (event.target.closest("#prepare-and-activate-night-mode")) {
    prepareAndActivateNightMode();
    return;
  }

  if (event.target.closest("#preview-daynight-gateway")) {
    previewDaynightGateway();
    return;
  }

  if (event.target.closest("#apply-daynight-gateways")) {
    applyDaynightGateways();
    return;
  }

  if (event.target.closest("#cleanup-daynight-time-controls")) {
    cleanupDaynightTimeControls();
    return;
  }

  if (event.target.closest("#reset-daynight-time-controls")) {
    resetDaynightTimeControls();
    return;
  }

  if (event.target.closest("#apply-daynight-gateway-routing")) {
    applyDaynightGatewayRouting();
    return;
  }

  if (event.target.closest("#plan-daynight-announcement-target")) {
    planDaynightAnnouncementTarget();
    return;
  }

  if (event.target.closest("#apply-daynight-announcement-target")) {
    applyDaynightAnnouncementTarget();
    return;
  }

  if (event.target.closest("#apply-profile-live")) {
    applyProfilePlan();
    return;
  }

  if (event.target.closest("#toggle-technical")) {
    state.technicalOpen = !state.technicalOpen;
    renderEndpoints();
    return;
  }

  if (event.target.closest("#load-service-groups")) {
    loadServiceGroups();
    return;
  }

  const serviceModeButton = event.target.closest("[data-service-mode]");
  if (serviceModeButton) {
    state.serviceMode = serviceModeButton.dataset.serviceMode;
    state.selectedServiceKey = "";
    state.serviceInspectorOpen = false;
    renderServices();
    return;
  }

  const serviceSelect = event.target.closest("[data-select-service]");
  if (serviceSelect) {
    state.selectedServiceKey = serviceSelect.dataset.selectService;
    state.serviceInspectorOpen = false;
    renderServices();
    return;
  }

  const serviceEdit = event.target.closest("[data-edit-service]");
  if (serviceEdit) {
    state.selectedServiceKey = serviceEdit.dataset.editService;
    state.serviceInspectorOpen = true;
    renderServices();
    return;
  }

  const serviceRemove = event.target.closest("[data-remove-service-member]");
  if (serviceRemove) {
    removeServiceMember(serviceRemove.dataset.serviceKind, serviceRemove.dataset.serviceId, serviceRemove.dataset.extensionNumber);
    return;
  }

  const serviceColor = event.target.closest("[data-update-service-color]");
  if (serviceColor) {
    updateServiceColor(serviceColor.dataset.serviceKind, serviceColor.dataset.serviceId, serviceColor.dataset.updateServiceColor);
    return;
  }

  if (event.target.closest("#apply-service-draft")) {
    applyServiceDraft();
    return;
  }

  const liveWritesButton = event.target.closest("[data-live-writes]");
  if (liveWritesButton) {
    setLiveWritesEnabled(liveWritesButton.dataset.liveWrites === "on");
    return;
  }

  if (event.target.closest("#undo-service-draft")) {
    undoServiceDraftChange();
    return;
  }
});

function toggleServiceNodeMembers(nodeId) {
  if (!nodeId) return;
  const expanded = new Set(state.expandedServiceNodeIds || []);
  if (expanded.has(nodeId)) expanded.delete(nodeId);
  else expanded.add(nodeId);
  state.expandedServiceNodeIds = [...expanded];
  requestCallflowRender();
}

async function exportFlowPdf() {
  const button = $("#export-flow-pdf");
  if (button?.disabled) return;
  const canvas = $("#callflow-canvas");
  if (!canvas?.querySelector(".flow-node")) return;
  if (button) button.disabled = true;
  try {
    const model = captureFlowPdfModel(canvas);
    // Let the disabled state paint before building a large document.
    await new Promise(resolve => window.requestAnimationFrame(resolve));
    const bytes = window.NfonCallflowPdf.create(model);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `callflow-${model.number.replace(/[^a-zA-Z0-9+-]/g, "").slice(0, 48) || "routing"}-${safeFileTimestamp()}.pdf`;
    document.body.appendChild(link);
    try { link.click(); } finally {
      link.remove();
      // Download consumers (including WebKit) may still need the blob after click.
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  } catch (error) {
    showUiNotice({
      title: portalMessage("portal.pdfExportFailed", "PDF could not be created"),
      message: error.code === "PDF_FONT_CHARACTER"
        ? portalMessage("portal.pdfUnsupportedCharacters", "Some characters are not supported by the PDF font.")
        : portalMessage("portal.pdfExportRetry", "Please reload the page and try again."),
    });
  } finally {
    if (button) button.disabled = false;
  }
}

function captureFlowPdfModel(canvas) {
  // Measure the existing target cards on a cloned flow, then restore the visible
  // canvas before yielding to the browser. Export never changes the user's draft.
  const originalFlow = state.flow, originalExpanded = state.expandedServiceNodeIds;
  const markup = canvas.innerHTML, scrollLeft = canvas.scrollLeft, scrollTop = canvas.scrollTop;
  const initialDid = canvas.dataset.initialDid;
  try {
    state.flow = clone(originalFlow);
    state.expandedServiceNodeIds = (state.flow?.nodes || [])
      .filter(node => ["QUEUE", "GROUP", "SKILL"].includes(normalizeTargetType(node.type)))
      .map(node => node.id);
    renderCallflow();
    return flowPdfModel(canvas);
  } finally {
    state.flow = originalFlow;
    state.expandedServiceNodeIds = originalExpanded;
    canvas.innerHTML = markup;
    canvas.scrollLeft = scrollLeft;
    canvas.scrollTop = scrollTop;
    if (initialDid === undefined) delete canvas.dataset.initialDid;
    else canvas.dataset.initialDid = initialDid;
  }
}

function flowPdfModel(canvas) {
  const graph = buildVisibleFlowGraph(state.flow);
  const themeStyle = getComputedStyle(document.documentElement);
  const canvasStyle = getComputedStyle(canvas);
  const gridElement = canvas.querySelector(".flow-world-wrap");
  const gridStyle = gridElement ? getComputedStyle(gridElement, "::before") : null;
  const dot = gridStyle?.backgroundImage?.match(/(rgba?\([^)]*\))\s+([\d.]+)px/);
  const spacing = gridStyle?.backgroundSize?.split(/\s+/).map(parseFloat);
  const zoom = state.flowZoom || 1;
  const grid = dot && spacing?.every(value => Number.isFinite(value) && value > 0) ? {
    color: dot[1], radius: Number(dot[2]) / zoom,
    stepX: spacing[0] / zoom, stepY: (spacing[1] || spacing[0]) / zoom,
    originX: ((parseFloat(gridStyle.backgroundPositionX) || 0) + spacing[0] / 2) / zoom,
    originY: ((parseFloat(gridStyle.backgroundPositionY) || 0) + (spacing[1] || spacing[0]) / 2) / zoom,
  } : null;
  // These are the same visible markers used by the designer; branches retain their labels.
  const arrows = [...canvas.querySelectorAll(".flow-insert.is-arrow")].map(element => {
    const style = getComputedStyle(element);
    return { x: parseFloat(element.style.left), y: parseFloat(element.style.top),
      width: element.offsetWidth, height: element.offsetHeight,
      angle: parseFloat(element.style.getPropertyValue("--flow-angle")) || 0,
      background: style.backgroundColor, borderColor: style.borderColor, color: style.color,
      borderWidth: parseFloat(style.borderTopWidth) || 1 };
  });
  const nodes = [...canvas.querySelectorAll(".flow-node")].map((element, index) => {
    const style = getComputedStyle(element);
    const type = element.querySelector(".node-type"), title = element.querySelector(".node-title");
    const metadata = [...element.querySelectorAll(".node-subtitle, .node-number-meta, .node-detail-summary, .node-detail:not(.service-node-detail), .node-warning")]
      .filter(item => item.textContent.trim());
    return {
      id: element.dataset.nodeId || graph.nodes[index]?.id,
      x: parseFloat(element.style.left), y: parseFloat(element.style.top),
      width: element.offsetWidth, height: element.offsetHeight,
      type: type?.textContent.trim() || "", title: title?.textContent.trim() || "",
      metadata: metadata.map(item => item.textContent.trim()),
      metadataColors: metadata.map(item => getComputedStyle(item).color),
      accent: style.borderTopColor, background: style.backgroundColor, borderColor: style.borderLeftColor,
      typeColor: type ? getComputedStyle(type).color : style.color,
      titleColor: title ? getComputedStyle(title).color : style.color,
    };
  });
  const measured = new Map(nodes.map(node => [node.id, { ...node, centerX: node.x + node.width / 2, centerY: node.y + node.height / 2 }]));
  const edges = [], labels = [];
  for (const edge of graph.edges) {
    const from = measured.get(edge.from), to = measured.get(edge.to);
    if (!from || !to) continue;
    const { fromPoint, c1, c2, toPoint } = flowConnectionCurve(from, to, edge.virtual && edge.memberSidePorts);
    edges.push({ points: [fromPoint.x, fromPoint.y, c1.x, c1.y, c2.x, c2.y, toPoint.x, toPoint.y] });
    if (edge.branchField && edge.label) labels.push({ ...cubicPointOnPath(fromPoint, c1, c2, toPoint, 0.62), text: edge.label });
  }
  const realNodes = graph.nodes.filter(node => !node.virtual);
  const byId = new Map(realNodes.map(node => [node.id, node]));
  return {
    overviewTitle: portalMessage("portal.flowPdfOverview", "Flow overview"),
    detailsTitle: portalMessage("portal.flowPdfDetails", "Routing details"),
    continued: portalMessage("portal.flowPdfContinued", "Continued"),
    number: selectedDid()?.name || selectedDid()?.id || "",
    accent: themeStyle.getPropertyValue(document.documentElement.dataset.nfonTheme === "admin-portal" ? "--nfon-blue" : "--accent").trim(),
    textColor: themeStyle.getPropertyValue("--text").trim(),
    mutedColor: themeStyle.getPropertyValue("--muted").trim(),
    borderColor: themeStyle.getPropertyValue("--line").trim(),
    canvas: { background: canvasStyle.backgroundColor, grid }, arrows,
    bounds: flowPrintContentBounds(canvas, edges), nodes, edges, labels,
    details: realNodes.map(node => {
      const members = flowPrintMembers(node);
      const rows = graph.edges.filter(edge => !edge.virtual && edge.from === node.id && byId.has(edge.to)).map(edge => {
        const target = byId.get(edge.to);
        const number = target.targetNumber || target.routeNumber || "";
        return `${edge.label || portalMessage("portal.nextStep", "Next step")} → ${target.title}${number ? ` (${number})` : ""}`;
      });
      rows.push(...members.map(member => `${portalMessage("portal.member", "member")} · ${member.name || ""}${member.number ? ` (${member.number})` : ""}`));
      return {
        type: readableNodeType(node.type), title: node.title, rows, hasMembers: members.length > 0,
        accent: measured.get(node.id)?.accent,
        typeColor: measured.get(node.id)?.typeColor, titleColor: measured.get(node.id)?.titleColor,
        metadata: [flowNodeSubtitle(node), flowNodeNumberMeta(node), members.length
          ? portalMessage("portal.valueMembers", "{p0} members", { p0: members.length, p1: "" })
          : flowNodeDetail(node)].filter(Boolean),
      };
    }),
  };
}

function flowPrintMembers(node) {
  if (!["QUEUE", "SKILL", "GROUP"].includes(normalizeTargetType(node.type))) return [];
  const meta = nodeServiceMeta(node);
  if (Array.isArray(meta.memberTargets) && meta.memberTargets.length) return meta.memberTargets;
  return (meta.memberNames || []).map(name => ({ name, number: "" }));
}

function flowPrintContentBounds(canvas, edges = []) {
  const nodes = [...canvas.querySelectorAll(".flow-node")];
  const fallbackWidth = 1120;
  const fallbackHeight = 760;
  if (!nodes.length) {
    return { left: 0, top: 0, width: fallbackWidth, height: fallbackHeight };
  }
  const padding = 96;
  const bounds = nodes.reduce((acc, node) => {
    const left = Number.parseFloat(node.style.left || "0") || 0;
    const top = Number.parseFloat(node.style.top || "0") || 0;
    const width = node.offsetWidth || 220;
    const height = node.offsetHeight || 120;
    return {
      left: Math.min(acc.left, left),
      top: Math.min(acc.top, top),
      right: Math.max(acc.right, left + width),
      bottom: Math.max(acc.bottom, top + height),
    };
  }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  for (const edge of edges) {
    for (let index = 0; index < edge.points.length; index += 2) {
      bounds.left = Math.min(bounds.left, edge.points[index]);
      bounds.right = Math.max(bounds.right, edge.points[index]);
      bounds.top = Math.min(bounds.top, edge.points[index + 1]);
      bounds.bottom = Math.max(bounds.bottom, edge.points[index + 1]);
    }
  }
  const left = Math.max(0, Math.floor(bounds.left - padding));
  const top = Math.max(0, Math.floor(bounds.top - padding));
  const right = Math.ceil(bounds.right + padding);
  const bottom = Math.ceil(bounds.bottom + padding);
  return {
    left,
    top,
    width: Math.max(420, right - left),
    height: Math.max(300, bottom - top),
  };
}

document.addEventListener("pointerdown", (event) => {
  const serviceList = event.target.closest("#service-extension-list");
  if (state.view === "services" && serviceList && !event.target.closest("[data-service-extension-id]") && event.button === 0) {
    const point = serviceListPoint(event, serviceList);
    state.serviceSelection = {
      active: true,
      list: serviceList,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
      moved: false,
    };
    state.selectedServiceExtensionIds = [];
    serviceList.classList.add("is-selecting");
    event.preventDefault();
    renderServices();
    return;
  }

  if (event.target.closest("[data-node-edit], [data-node-delete], [data-node-members-toggle]")) return;
  if (event.target.closest("[data-insert-from][data-insert-to]")) return;
  const dockButton = event.target.closest("[data-node-dock]");
  if (dockButton && state.view === "callflow") {
    const canvas = $("#callflow-canvas");
    const node = (state.flow?.nodes || []).find((item) => item.id === dockButton.dataset.nodeDock);
    if (!canvas || !node || event.button !== 0) return;
    const current = pointerWorldPosition(event, canvas);
    const nodeElement = dockButton.closest(".flow-node[data-node-id]");
    cableDragState = {
      fromId: node.id,
      start: dockPointForBox(nodeElementWorldBox(node, nodeElement), current),
      canvas,
      current,
      moved: false,
    };
    state.cableDrag = { ...cableDragState };
    document.body.classList.add("is-cabling");
    clearNodeDockHover();
    dockButton.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    renderCallflow();
    return;
  }

  const paletteButton = event.target.closest("[data-flow-palette-target], [data-flow-empty-step]");
  if (paletteButton && state.view === "callflow") {
    let target = null;
    if (paletteButton.hasAttribute("data-flow-empty-step")) {
      target = emptyFlowStepTarget();
    } else {
      try {
        target = JSON.parse(paletteButton.dataset.flowPaletteTarget || "null");
      } catch {
        target = null;
      }
    }
    if (!target || event.button !== 0) return;
    const sourceRect = paletteButton.getBoundingClientRect();
    paletteDragState = {
      target,
      source: paletteButton,
      offsetX: event.clientX - sourceRect.left,
      offsetY: event.clientY - sourceRect.top,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
    };
    state.paletteDrag = { title: target.title || targetTypeLabel(target.type), x: event.clientX, y: event.clientY };
    paletteButton.classList.add("is-drag-source");
    updatePaletteDragGhost(event.clientX, event.clientY, paletteButton, paletteDragState.offsetX, paletteDragState.offsetY);
    document.body.classList.add("is-palette-dragging");
    paletteButton.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    return;
  }
  const nodeButton = event.target.closest("[data-node-id]");
  const canvas = $("#callflow-canvas");
  if (!canvas || state.view !== "callflow") return;
  if (event.button !== 0) return;

  if (!nodeButton && event.target.closest("#callflow-canvas")) {
    if (event.shiftKey) {
      const start = pointerWorldPosition(event, canvas);
      selectionRectState = {
        canvas,
        pointerId: event.pointerId,
        start,
        current: start,
        moved: false,
      };
      state.selectedNodeId = "";
      state.selectedNodeIds = [];
      state.selectedBranchField = "";
      state.inspectorOpen = false;
      document.body.classList.add("is-selecting-canvas");
      canvas.classList.add("is-selecting");
      canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      renderCallflow();
      return;
    }
    panState = {
      canvas,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: canvas.scrollLeft,
      scrollTop: canvas.scrollTop,
      moved: false,
    };
    canvas.classList.add("is-panning");
    canvas.classList.remove("is-hovering");
    document.body.classList.add("is-panning-canvas");
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    return;
  }

  if (!nodeButton) return;
  const node = (state.flow?.nodes || []).find((item) => item.id === nodeButton.dataset.nodeId) || visibleFlowNodeById(nodeButton.dataset.nodeId);
  if (!node) return;

  const world = pointerWorldPosition(event, canvas);
  const box = nodeWorldBox(node);
  dragState = {
    id: node.id,
    memberNode: Boolean(node.memberNode),
    serviceNodeId: node.serviceNodeId || "",
    memberKey: node.memberKey || "",
    canvas,
    offsetX: world.x - box.x,
    offsetY: world.y - box.y,
    moved: false,
  };
  state.selectedNodeId = node.id;
  state.selectedNodeIds = [];
  state.selectedBranchField = "";
  document.body.classList.add("is-dragging");
  nodeButton.setPointerCapture?.(event.pointerId);
});

document.addEventListener("pointermove", (event) => {
  if (state.serviceSelection?.active) {
    updateServiceExtensionSelection(event);
    event.preventDefault();
    return;
  }

  if (paletteDragState) {
    const deltaX = event.clientX - paletteDragState.startX;
    const deltaY = event.clientY - paletteDragState.startY;
    paletteDragState.moved = paletteDragState.moved || Math.hypot(deltaX, deltaY) > 4;
    state.paletteDrag = {
      title: paletteDragState.target.title || targetTypeLabel(paletteDragState.target.type),
      x: event.clientX,
      y: event.clientY,
    };
    updatePaletteDragGhost(
      event.clientX,
      event.clientY,
      paletteDragState.source || state.paletteDrag.title,
      paletteDragState.offsetX || 0,
      paletteDragState.offsetY || 0,
    );
    event.preventDefault();
    return;
  }

  if (cableDragState) {
    cableDragState.current = pointerWorldPosition(event, cableDragState.canvas);
    cableDragState.moved = true;
    state.cableDrag = { ...cableDragState };
    requestCallflowRender();
    event.preventDefault();
    return;
  }

  if (selectionRectState) {
    selectionRectState.current = pointerWorldPosition(event, selectionRectState.canvas);
    const deltaX = selectionRectState.current.x - selectionRectState.start.x;
    const deltaY = selectionRectState.current.y - selectionRectState.start.y;
    selectionRectState.moved = Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4;
    suppressCanvasClick = true;
    requestCallflowRender();
    event.preventDefault();
    return;
  }
  if (panState) {
    const deltaX = event.clientX - panState.startX;
    const deltaY = event.clientY - panState.startY;
    panState.canvas.scrollLeft = panState.scrollLeft - deltaX;
    panState.canvas.scrollTop = panState.scrollTop - deltaY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      panState.moved = true;
      suppressCanvasClick = true;
    }
    event.preventDefault();
    return;
  }
  if (!dragState) {
    updateNodeDockHover(event);
    updateCanvasHover(event);
    return;
  }
  const pointer = pointerWorldPosition(event, dragState.canvas);
  const nextPosition = safeFlowPosition(
    ((pointer.x - dragState.offsetX) / FLOW_WORLD_WIDTH) * 100,
    ((pointer.y - dragState.offsetY) / FLOW_POSITION_HEIGHT) * 100,
  );
  const node = (state.flow?.nodes || []).find((item) => item.id === dragState.id);
  const currentPosition = node || (dragState.memberNode ? visibleFlowNodeById(dragState.id) : null);
  if (currentPosition && Number(currentPosition.x) === nextPosition.x && Number(currentPosition.y) === nextPosition.y) return;
  if (!dragState.moved) rememberFlowUndo();
  if (node) {
    Object.assign(node, nextPosition);
  } else if (dragState.memberNode) {
    setServiceMemberLayout(dragState.serviceNodeId, dragState.memberKey, nextPosition);
  } else {
    return;
  }
  dragState.moved = true;
  // Keep the cursor spotlight in the dot grid aligned while a node is dragged.
  updateCanvasHover(event);
  requestCallflowRender();
});

document.addEventListener("pointerup", (event) => {
  if (paletteDragState) {
    const canvas = $("#callflow-canvas");
    const target = paletteDragState.target;
    const dropNode = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest?.("[data-node-id]");
    const targetNode = dropNode
      ? (state.flow?.nodes || []).find((node) => node.id === dropNode.dataset.nodeId) || visibleFlowNodeById(dropNode.dataset.nodeId)
      : null;
    const rect = canvas?.getBoundingClientRect();
    const inside = canvas && rect
      && event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom;
    paletteDragState = null;
    state.paletteDrag = null;
    removePaletteDragGhost();
    document.body.classList.remove("is-palette-dragging");
    const extensionTarget = normalizeTargetType(target?.type) === "PHONEEXTENSION" ? flowExtensionTarget(target) : null;
    if (extensionTarget && targetNode) {
      assignExtensionDropToNode(targetNode, extensionTarget, pointerWorldPosition(event, canvas));
      return;
    }
    if (inside) {
      addPaletteNodeToCanvas(target, pointerWorldPosition(event, canvas));
    }
    return;
  }

  if (cableDragState) {
    const targetNode = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest?.("[data-node-id]");
    const toId = targetNode?.dataset?.nodeId || "";
    const fromId = cableDragState.fromId;
    cableDragState = null;
    state.cableDrag = null;
    document.body.classList.remove("is-cabling");
    clearNodeDockHover();
    if (toId) connectFlowNodes(fromId, toId);
    else renderCallflow();
    return;
  }

  if (state.serviceSelection?.active) {
    clearServiceSelectionBox();
    return;
  }

  if (selectionRectState) {
    const rect = normalizedSelectionRect();
    const hitIds = rect && selectionRectState.moved
      ? (state.flow?.nodes || [])
        .filter((node) => !node.locked && nodeIntersectsRect(node, rect))
        .map((node) => node.id)
      : [];
    state.selectedNodeIds = hitIds;
    state.selectedNodeId = hitIds.length === 1 ? hitIds[0] : "";
    state.selectedBranchField = "";
    state.inspectorOpen = hitIds.length > 1;
    suppressCanvasClick = true;
    selectionRectState.canvas.classList.remove("is-selecting");
    document.body.classList.remove("is-selecting-canvas");
    selectionRectState = null;
    renderCallflow();
    renderFlowHelper();
    renderView();
    return;
  }
  if (panState) {
    suppressCanvasClick = panState.moved;
    panState.canvas.classList.remove("is-panning");
    document.body.classList.remove("is-panning-canvas");
    panState = null;
    return;
  }
  if (!dragState) return;
  const moved = dragState.moved;
  dragState = null;
  document.body.classList.remove("is-dragging");
  if (moved) {
    saveCurrentFlowLayout();
    saveCurrentFlowDraft(false);
    renderFlowHelper();
    renderView();
  }
});

document.addEventListener("pointercancel", () => {
  if (state.serviceSelection?.active) {
    clearServiceSelectionBox();
  }

  if (selectionRectState) {
    selectionRectState.canvas.classList.remove("is-selecting");
    document.body.classList.remove("is-selecting-canvas");
    selectionRectState = null;
  }
  if (panState) {
    panState.canvas.classList.remove("is-panning");
    document.body.classList.remove("is-panning-canvas");
    panState = null;
  }
  if (dragState) {
    dragState = null;
    document.body.classList.remove("is-dragging");
  }
  if (paletteDragState) {
    paletteDragState = null;
    state.paletteDrag = null;
    removePaletteDragGhost();
    document.body.classList.remove("is-palette-dragging");
  }
  if (cableDragState) {
    cableDragState = null;
    state.cableDrag = null;
    document.body.classList.remove("is-cabling");
    clearNodeDockHover();
    renderCallflow();
  }
});

document.addEventListener("keydown", (event) => {
  if (uiDialog.open) {
    if (event.key === "Escape" && !uiDialog.pending) {
      event.preventDefault();
      closeUiDialog(false);
    } else if (event.key === "Tab") {
      trapModalTab(event, $("#app-dialog-modal"));
    }
    return;
  }

  if (state.daynightModeModal && !$("#daynight-mode-modal")?.hidden) {
    if (event.key === "Escape" && !state.daynightModeModal?.busy) {
      event.preventDefault();
      closeDaynightModeModal();
    } else if (event.key === "Tab") {
      const modal = $("#daynight-mode-modal");
      trapModalTab(event, modal, modal?.querySelector(".daynight-mode-dialog"));
    }
    return;
  }

  if (state.resourceCreateKind || state.resourceModalKind) {
    const creating = Boolean(state.resourceCreateKind);
    if (event.key === "Escape" && !state.resourceCreating && !state.resourceDeleting) {
      event.preventDefault();
      creating ? closeResourceCreateModal() : closeResourceModal();
    } else if (event.key === "Tab") trapModalTab(event, $(creating ? "#resource-create-modal" : "#resource-modal"));
    return;
  }

  const batchField = event.target?.dataset?.extensionBatchField;
  if (batchField && event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    const row = event.target.closest("[data-extension-batch-row]");
    insertExtensionBatchRowAfter(Number(row?.dataset.extensionBatchRow || 0));
    return;
  }

  const editable = event.target?.closest?.('input, textarea, select, [contenteditable="true"]');
  if (!editable && ["Enter", " "].includes(event.key)) {
    const extension = event.target?.closest?.("[data-service-extension-id]");
    if (state.view === "services" && extension) {
      const service = selectedService();
      if (service) { event.preventDefault(); addServiceMember(serviceTypeFromMode(), serviceId(service), extension.dataset.serviceExtensionId); }
      return;
    }
    const palette = event.target?.closest?.("[data-flow-palette-target], [data-flow-empty-step]");
    if (state.view === "callflow" && palette) {
      event.preventDefault();
      const target = palette.hasAttribute("data-flow-empty-step") ? emptyFlowStepTarget() : JSON.parse(palette.dataset.flowPaletteTarget);
      const canvas = $("#callflow-canvas");
      addPaletteNodeToCanvas(target, { x: (canvas?.scrollLeft || 0) + 160, y: (canvas?.scrollTop || 0) + 160 });
      return;
    }
  }
  if (state.view !== "callflow") return;
  if (!editable && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); undoFlowChange(); return; }
  if (!["Backspace", "Delete"].includes(event.key)) return;
  const target = event.target;
  if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable=\"true\"]")) return;
  if (!selectedNode() && selectedNodes().length <= 1) return;
  event.preventDefault();
  if (selectedNodes().length > 1) deleteSelectedNodes();
  else deleteSelectedNode();
});

function updatePaletteDragGhost(x, y, source, offsetX = 0, offsetY = 0) {
  let ghost = document.querySelector(".flow-palette-drag-ghost");
  if (!ghost) {
    ghost = document.createElement("div");
    ghost.className = "flow-palette-drag-ghost";
    document.body.appendChild(ghost);
  }
  if (source instanceof HTMLElement) {
    ghost.innerHTML = source.innerHTML;
    ghost.style.width = `${source.getBoundingClientRect().width}px`;
  } else {
    ghost.textContent = source || "Callflow-Kachel";
    ghost.style.width = "";
  }
  ghost.style.left = `${x - offsetX}px`;
  ghost.style.top = `${y - offsetY}px`;
}

function removePaletteDragGhost() {
  document.querySelectorAll(".flow-palette-item.is-drag-source").forEach((item) => item.classList.remove("is-drag-source"));
  document.querySelector(".flow-palette-drag-ghost")?.remove();
}

function pointerWorldPosition(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const zoom = state.flowZoom || 1;
  return {
    x: (event.clientX - rect.left + canvas.scrollLeft) / zoom,
    y: (event.clientY - rect.top + canvas.scrollTop) / zoom,
  };
}

function clearNodeDockHover() {
  if (activeDockHoverElement) {
    activeDockHoverElement.classList.remove("is-dock-hover");
    activeDockHoverElement.style.removeProperty("--dock-x");
    activeDockHoverElement.style.removeProperty("--dock-y");
  }
  activeDockHoverElement = null;
  activeDockHoverNodeId = "";
  activeDockHoverNode = null;
  activeDockHoverX = "";
  activeDockHoverY = "";
}

function updateNodeDockHover(event) {
  const canvas = $("#callflow-canvas");
  if (!canvas || state.view !== "callflow") {
    clearNodeDockHover();
    return;
  }
  if (panState || dragState || selectionRectState || cableDragState || paletteDragState) {
    clearNodeDockHover();
    return;
  }
  if (!(event.target instanceof HTMLElement)) {
    clearNodeDockHover();
    return;
  }
  if (event.target.closest(".node-action-buttons, .node-detail-toggle, .node-member-list, .flow-menu-launcher, .flow-rail-panel, .zoom-control")) {
    clearNodeDockHover();
    return;
  }
  const nodeElement = event.target.closest(".flow-node[data-node-id]");
  if (!nodeElement || !canvas.contains(nodeElement)) {
    clearNodeDockHover();
    return;
  }
  const nodeId = nodeElement.dataset.nodeId || "";
  const node = nodeId === activeDockHoverNodeId && activeDockHoverNode
    ? activeDockHoverNode
    : (state.flow?.nodes || []).find((item) => item.id === nodeId);
  if (!node) {
    clearNodeDockHover();
    return;
  }
  const box = nodeElementWorldBox(node, nodeElement);
  const point = dockPointForBox(box, pointerWorldPosition(event, canvas));
  const nextX = `${Math.round(point.x - box.x)}px`;
  const nextY = `${Math.round(point.y - box.y)}px`;
  if (activeDockHoverElement && activeDockHoverElement !== nodeElement) {
    activeDockHoverElement.classList.remove("is-dock-hover");
    activeDockHoverElement.style.removeProperty("--dock-x");
    activeDockHoverElement.style.removeProperty("--dock-y");
  }
  if (activeDockHoverElement !== nodeElement || activeDockHoverX !== nextX || activeDockHoverY !== nextY) {
    nodeElement.style.setProperty("--dock-x", nextX);
    nodeElement.style.setProperty("--dock-y", nextY);
  }
  if (activeDockHoverElement !== nodeElement) {
    nodeElement.classList.add("is-dock-hover");
  }
  activeDockHoverElement = nodeElement;
  activeDockHoverNodeId = node.id;
  activeDockHoverNode = node;
  activeDockHoverX = nextX;
  activeDockHoverY = nextY;
}

function updateCanvasHover(event) {
  const canvas = $("#callflow-canvas");
  if (!canvas || state.view !== "callflow") return;
  if (panState || selectionRectState || canvas.classList.contains("is-scrolling")) return;
  const rect = canvas.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  canvas.classList.toggle("is-hovering", inside);
  if (!inside) return;
  pendingHoverPoint = {
    canvas,
    x: event.clientX - rect.left + canvas.scrollLeft,
    y: event.clientY - rect.top + canvas.scrollTop,
  };
  if (hoverFrame) return;
  hoverFrame = requestAnimationFrame(() => {
    hoverFrame = 0;
    if (!pendingHoverPoint) return;
    pendingHoverPoint.canvas.style.setProperty("--grid-x", `${pendingHoverPoint.x}px`);
    pendingHoverPoint.canvas.style.setProperty("--grid-y", `${pendingHoverPoint.y}px`);
    pendingHoverPoint = null;
  });
}

function zoomCanvasByWheel(event) {
  const canvas = $("#callflow-canvas");
  if (!canvas || state.view !== "callflow") return;
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const current = state.flowZoom || 1;
  const delta = event.deltaY < 0 ? 0.035 : -0.035;
  const next = clamp(current + delta, FLOW_MIN_ZOOM, FLOW_MAX_ZOOM);
  if (next === current) return;

  const rect = canvas.getBoundingClientRect();
  const pointerX = event.clientX - rect.left + canvas.scrollLeft;
  const pointerY = event.clientY - rect.top + canvas.scrollTop;
  const worldX = pointerX / current;
  const worldY = pointerY / current;
  state.flowZoom = next;
  renderCallflow();
  canvas.scrollLeft = Math.max(0, worldX * next - (event.clientX - rect.left));
  canvas.scrollTop = Math.max(0, worldY * next - (event.clientY - rect.top));
  updateCanvasHover(event);
}

document.addEventListener("wheel", zoomCanvasByWheel, { passive: false });

window.addEventListener("resize", fitFlowDidMenu);
window.visualViewport?.addEventListener("resize", fitFlowDidMenu);
window.visualViewport?.addEventListener("scroll", fitFlowDidMenu);
document.addEventListener("scroll", fitFlowDidMenu, true);
document.addEventListener("nfon:theme-change", fitFlowDidMenu);

document.addEventListener("scroll", (event) => {
  const canvas = event.target?.closest?.("#callflow-canvas");
  if (!canvas) return;
  canvas.classList.add("is-scrolling");
  canvas.classList.remove("is-hovering");
  window.clearTimeout(flowScrollTimer);
  flowScrollTimer = window.setTimeout(() => {
    canvas.classList.remove("is-scrolling");
  }, 140);
}, true);

document.addEventListener("gesturestart", (event) => {
  if (!event.target?.closest?.("#callflow-canvas")) return;
  event.preventDefault();
  gestureZoomStart = state.flowZoom || 1;
}, { passive: false });

document.addEventListener("gesturechange", (event) => {
  if (!event.target?.closest?.("#callflow-canvas")) return;
  event.preventDefault();
  const scale = Number(event.scale || 1);
  const dampedScale = 1 + (scale - 1) * 0.35;
  setFlowZoom(gestureZoomStart * dampedScale);
}, { passive: false });

document.addEventListener("input", (event) => {
  if (event.target.classList?.contains("select-filter-input")) {
    filterSearchableSelect(event.target);
    return;
  }

  if (event.target.id === "daynight-announcement-display-name") {
    state.daynightAnnouncementDisplayName = event.target.value;
    state.daynightAnnouncementDisplayNameEdited = true;
    resetDaynightAnnouncementPlan();
    const canPlan = Boolean(event.target.value.trim() && (state.daynightAnnouncementSource || "existing") === "existing" && daynightAnnouncementOptions().length);
    const planButton = $("#plan-daynight-announcement-target");
    if (planButton) planButton.disabled = !canPlan;
    $("#apply-daynight-announcement-target")?.setAttribute("disabled", "");
    return;
  }

  if (event.target.id === "extension-filter") {
    state.extensionFilter = event.target.value;
    renderExtensions();
    return;
  }

  if (event.target.closest("#manual-customer-form") && event.target.name === "account") {
    state.manualCustomerAccount = event.target.value;
    state.customerSwitchFeedback = "";
    return;
  }

  const phonebookManualField = event.target.dataset.phonebookManualField;
  if (phonebookManualField) {
    state.phonebookManualDraft = {
      ...state.phonebookManualDraft,
      [phonebookManualField]: event.target.value,
    };
    state.phonebookManualDirty = state.phonebookManualRows.length > 0 || Object.values(state.phonebookManualDraft).some((value) => String(value || "").trim());
    state.phonebookUploadFeedback = null;
    return;
  }

  const batchField = event.target.dataset.extensionBatchField;
  if (batchField) {
    if (event.target.type !== "checkbox") {
      setExtensionBatchField(event.target.closest("[data-extension-batch-row]"), batchField, event.target.value);
    }
    return;
  }

  if (event.target.id === "service-extension-filter") {
    state.serviceFilter = event.target.value;
    renderServices();
    return;
  }

  const serviceCreateField = event.target.dataset.serviceCreateField;
  if (serviceCreateField) {
    const form = event.target.closest("[data-service-create-kind]");
    updateServiceCreateDraft(form?.dataset.serviceCreateKind || serviceTypeFromMode(), serviceCreateField, event.target.value);
    return;
  }

  if (event.target.id === "flow-extension-filter") {
    state.flowExtensionFilter = event.target.value;
    renderFlowResourcePalette({ preserveSearch: true });
    renderView();
    return;
  }

  if (event.target.id === "demo-toggle") {
    state.demoMode = event.target.checked;
    const firstDid = getOverview()?.inventory?.dids?.[0];
    state.selectedDidId = firstDid?.id || "";
    const baseFlow = applyStoredFlowLayout(buildFlowForDid(selectedDid(), getOverview()), selectedDid());
    flowUndoHistory.length = 0;
    state.flow = applyStoredFlowDraft(applyStoredAppliedFlow(baseFlow, selectedDid()), selectedDid());
    state.selectedNodeId = "";
    state.selectedNodeIds = [];
    state.inspectorOpen = false;
    state.selectedBranchField = "";
    state.actionPlan = null;
    state.flowFeedback = null;
    render();
    return;
  }

  const nodeField = event.target.dataset.nodeField;
  if (nodeField) {
    if (event.target.tagName !== "SELECT") updateNodeFieldWithoutHelperRender(nodeField, event.target.value);
    return;
  }

  const configField = event.target.dataset.nodeConfigField;
  if (configField) {
    if (event.target.tagName !== "SELECT") updateNodeConfigWithoutHelperRender(configField, event.target.value);
  }
});

document.addEventListener("focusout", (event) => {
  if (event.target.dataset?.nodeField || event.target.dataset?.nodeConfigField) flowTextUndo = null;
});

document.addEventListener("change", (event) => {
  if (event.target.id === "daynight-mode-toggle") {
    const nextActive = event.target.checked;
    event.target.checked = state.daynightActive;
    toggleDaynightMode(nextActive);
    return;
  }

  if (event.target.id === "standard-flow-import-file") {
    importStandardProfileFile(event.target.files?.[0], state.view === "callflow" ? "callflow" : "changes");
    event.target.value = "";
    return;
  }


  if (event.target.id === "target-select") {
    applyTargetSelection(event.target.value);
    return;
  }

  if (event.target.id === "bulk-target-select") {
    applyBulkTargetSelection(event.target.value);
    return;
  }

  if (event.target.id === "flow-connect-target") {
    const node = selectedNode();
    const targetId = event.target.value;
    event.target.value = "";
    if (node && targetId) connectFlowNodes(node.id, targetId);
    return;
  }

  if (event.target.id === "profile-target-select") {
    state.profileTargetValue = event.target.value;
    renderChangeAssistant();
    return;
  }

  if (event.target.id === "flow-profile-target-select") {
    state.profileTargetValue = event.target.value;
    renderFlowProfileActions();
    return;
  }

  if (event.target.id === "daynight-gateway-target-select") {
    state.profileTargetValue = event.target.value;
    state.daynightGatewayPreview = null;
    state.daynightOperationFeedback = null;
    renderFlowProfileActions();
    renderDaynightGatewayPreview();
    return;
  }

  if (event.target.id === "daynight-announcement-select") {
    state.daynightAnnouncementName = event.target.value;
    resetDaynightAnnouncementPlan();
    renderDaynightGatewayPreview();
    return;
  }

  if (event.target.name === "daynight-announcement-source") {
    state.daynightAnnouncementSource = event.target.value === "upload" ? "upload" : "existing";
    resetDaynightAnnouncementPlan();
    renderDaynightGatewayPreview();
    return;
  }

  if (event.target.id === "daynight-announcement-after-select") {
    state.daynightAnnouncementAfterValue = event.target.value;
    resetDaynightAnnouncementPlan();
    renderDaynightGatewayPreview();
    return;
  }

  if (event.target.id === "service-color-select") {
    updateServiceColor(event.target.dataset.serviceKind, event.target.dataset.serviceId, event.target.value);
    return;
  }

  if (event.target.id === "extension-batch-csv") {
    loadExtensionBatchCsv(event.target.files?.[0]);
    return;
  }

  const batchOption = event.target.dataset.extensionBatchOption;
  if (batchOption) {
    updateExtensionBatchSelectedField(batchOption, event.target.checked);
    renderExtensionBatch();
    return;
  }

  const batchField = event.target.dataset.extensionBatchField;
  if (batchField) {
    setExtensionBatchField(event.target.closest("[data-extension-batch-row]"), batchField, event.target.type === "checkbox" ? event.target.checked : event.target.value);
    return;
  }

  const nodeField = event.target.dataset.nodeField;
  if (nodeField) {
    if (event.target.tagName === "SELECT") updateNodeField(nodeField, event.target.value);
    else flowTextUndo = null;
  }

  const configField = event.target.dataset.nodeConfigField;
  if (configField) {
    if (event.target.tagName === "SELECT") updateNodeConfig(configField, event.target.value);
    else flowTextUndo = null;
  }

  const targetConfig = event.target.dataset.nodeTargetConfig;
  if (targetConfig) updateNodeTargetConfig(targetConfig, event.target.value);

  if (event.target.dataset.nodeResourceTarget) {
    applyResourceTargetSelection(event.target.value);
    return;
  }

  const serviceMemberInput = event.target.closest("[data-update-service-member]");
  if (serviceMemberInput) {
    const rawValue = serviceMemberInput.type === "checkbox" ? serviceMemberInput.checked : serviceMemberInput.value;
    const value = serviceMemberInput.dataset.field === "enabled" ? Boolean(rawValue) : Number(rawValue);
    updateServiceMember(
      serviceMemberInput.dataset.serviceKind,
      serviceMemberInput.dataset.serviceId,
      serviceMemberInput.dataset.extensionNumber,
      { [serviceMemberInput.dataset.field]: value }
    );
  }
});

document.addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-service-extension-id]");
  if (!card) return;
  const selected = new Set(state.selectedServiceExtensionIds || []);
  if (!selected.has(card.dataset.serviceExtensionId)) {
    state.selectedServiceExtensionIds = [card.dataset.serviceExtensionId];
    card.classList.add("is-selected");
  }
  const draggedIds = state.selectedServiceExtensionIds.length ? state.selectedServiceExtensionIds : [card.dataset.serviceExtensionId];
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("application/json", JSON.stringify(draggedIds));
  event.dataTransfer.setData("text/plain", draggedIds.join(","));
  document.body.classList.add("is-service-dragging");
});

document.addEventListener("dragend", () => {
  document.body.classList.remove("is-service-dragging");
  document.querySelectorAll(".service-card.is-drop-target").forEach((card) => card.classList.remove("is-drop-target"));
});

document.addEventListener("dragover", (event) => {
  const card = event.target.closest("[data-service-card]");
  if (!card) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  card.classList.add("is-drop-target");
});

document.addEventListener("dragleave", (event) => {
  const card = event.target.closest("[data-service-card]");
  if (!card || card.contains(event.relatedTarget)) return;
  card.classList.remove("is-drop-target");
});

document.addEventListener("drop", (event) => {
  const card = event.target.closest("[data-service-card]");
  if (!card) return;
  event.preventDefault();
  card.classList.remove("is-drop-target");
  let extensionIds = [];
  try {
    extensionIds = JSON.parse(event.dataTransfer.getData("application/json") || "[]");
  } catch {
    extensionIds = [];
  }
  if (!extensionIds.length) extensionIds = event.dataTransfer.getData("text/plain").split(",").filter(Boolean);
  addServiceMembers(card.dataset.serviceKind, card.dataset.serviceId, extensionIds);
});

document.addEventListener("submit", (event) => {
  if (event.target.id === "phonebook-upload-form") {
    event.preventDefault();
    uploadPhonebookContacts(event.target);
    return;
  }

  if (event.target.id === "resource-create-form") {
    event.preventDefault();
    createResource(event.target);
    return;
  }

  if (event.target.matches("[data-service-create-kind]")) {
    event.preventDefault();
    createServiceGroup(event.target.dataset.serviceCreateKind || serviceTypeFromMode());
    return;
  }

  if (event.target.id === "browser-login-form") {
    event.preventDefault();
    applyBrowserLogin(event.target);
    return;
  }

  if (event.target.id === "clone-form") {
    event.preventDefault();
    submitAction(event.target, "/api/demo/clone-extension", { source: selectedExtension() }, "extensions");
    return;
  }

  if (event.target.id === "create-form") {
    event.preventDefault();
    submitAction(event.target, "/api/demo/create-extension", {}, "extensions");
  }
});

document.addEventListener("nfon:language-change", refreshPortalDefaults);
document.addEventListener("nfon:demo-pause", event => {
  state.staticPaused = Boolean(event.detail?.paused);
  renderStatus();
});
window.addEventListener("hashchange", () => {
  const view = initialView();
  if (view !== state.view) setView(view);
});
document.addEventListener("input", (event) => {
  if (event.target?.hasAttribute?.("data-portal-default-key")) event.target.removeAttribute("data-portal-default-key");
});


// An outdated membership intent is never silently discarded or silently rebased.
async function reviewServiceDraftConflicts() {
  const preparedDraft = state.serviceDraft;
  const conflicts = state.serviceDraftConflicts;
  const writeContext = state.overview?.settings?.writeContext;
  const review = (state.serviceDraftConflicts || []).map(({previous}) => {const delta=membershipDelta(previous);return `${previous.name || previous.serviceNumber}\n${portalMessage("portal.add", "Add")}: ${delta.add.map(m=>m.extensionNumber).join(", ") || "—"}\n${portalMessage("portal.remove", "Remove")}: ${delta.remove.join(", ") || "—"}\n${portalMessage("portal.edit", "Edit")}: ${delta.update.map(m=>m.extensionNumber).join(", ") || "—"}`;}).join("\n\n");
  const confirmed = await confirmUi({
    title: portalMessage("portal.reviewChanges", "Review saved changes"),
    message: portalMessage("portal.staleDraft", "Memberships changed. Saved changes need review.") + "\n\n" + review,
    confirmLabel: portalMessage("portal.applyChanges", "Apply changes"),
  });
  if (!confirmed || state.serviceDraft !== preparedDraft || state.serviceDraftConflicts !== conflicts || !isCurrentWriteContext(writeContext)) return;
  const unresolved=[];
  for (const {collection,id,previous} of state.serviceDraftConflicts || []) {
    const current=state.serviceDraft?.[collection]?.[id];
    if (!current?.baseRevision) { unresolved.push({collection,id,previous}); continue; }
    const delta=membershipDelta(previous);
    const members=new Map(current.members.map(member=>[String(member.extensionNumber),member]));
    delta.remove.forEach(id=>members.delete(String(id)));
    delta.add.forEach(member=>{if(!members.has(String(member.extensionNumber)))members.set(String(member.extensionNumber),member);});
    delta.update.forEach(member=>{if(members.has(String(member.extensionNumber)))members.set(String(member.extensionNumber),member);});
    current.members=[...members.values()];
  }
  state.serviceDraftConflicts=unresolved; state.serviceDraft.conflicts=unresolved;
  writeStoredServiceDraft(state.serviceDraft); renderServices();
}
document.addEventListener("click", event => {
  if (event.target.closest("#review-service-conflicts")) reviewServiceDraftConflicts();
});

bindStaticNavigation();
loadOverview();
