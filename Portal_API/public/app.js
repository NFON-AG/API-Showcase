const VIEW_IDS = new Set(["overview", "phonebook", "extensions", "services", "callflow", "changes"]);

function initialView() {
  const hashView = window.location.hash.replace(/^#/, "");
  return VIEW_IDS.has(hashView) ? hashView : "overview";
}

const state = {
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
  daynightAnnouncementLoading: false,
  daynightUseAnnouncement: false,
  daynightAnnouncementSource: "existing",
  daynightAnnouncementName: "",
  daynightAnnouncementAfterValue: "",
  daynightAnnouncementDisplayName: "",
  daynightActive: localStorage.getItem("nfon-portal-daynight-active") === "1",
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
  customers: [],
  customersLoading: false,
  customersError: "",
  customerSwitching: false,
  manualCustomerAccount: "",
  customerSwitchFeedback: "",
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
  cancelLabel: "Abbrechen",
  showCancel: false,
  pending: false,
  resolve: null,
};
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
const FLOW_LAYOUT_STORAGE_KEY = "nfon-portal-flow-layouts-v1";
const FLOW_PROFILE_STORAGE_KEY = "nfon-portal-callflow-profiles-v1";
const FLOW_DRAFT_STORAGE_KEY = "nfon-portal-flow-drafts-v1";
const FLOW_APPLIED_STORAGE_KEY = "nfon-portal-flow-applied-v1";
const DAYNIGHT_ACTIVE_STORAGE_KEY = "nfon-portal-daynight-active";
const SERVICE_DRAFT_STORAGE_KEY = "nfon-portal-service-drafts-v1";
const SERVICE_COLOR_PALETTE = [
  { id: "blue", label: "Blau", accent: "#1674d1", soft: "#e9f4ff" },
  { id: "green", label: "Gruen", accent: "#00d981", soft: "#e7f8ef" },
  { id: "amber", label: "Gold", accent: "#d39a25", soft: "#fff6df" },
  { id: "teal", label: "Tuerkis", accent: "#009f8f", soft: "#e4f8f5" },
  { id: "coral", label: "Koralle", accent: "#f36b5b", soft: "#fff0ee" },
  { id: "purple", label: "Violett", accent: "#7146f2", soft: "#eee9ff" },
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
  queues: { label: "Warteschlangen", itemLabel: "Warteschlange", type: "QUEUE", collection: "queues" },
  skills: { label: "Skillgruppen", itemLabel: "Skillgruppe", type: "SKILL", collection: "skills" },
  ivrs: { label: "Sprachdialoge", itemLabel: "Sprachdialog", type: "IVR", collection: "ivrs" },
  timeControls: { label: "Zeitsteuerungen", itemLabel: "Zeitsteuerung", type: "TIMECONTROL", collection: "timeControls" },
};
const RESOURCE_STEP_KINDS = new Set(["QUEUE", "GROUP", "SKILL", "IVR", "TIMECONTROL"]);
const WEEKDAY_OPTIONS = [
  ["MONDAY", "Montag"],
  ["TUESDAY", "Dienstag"],
  ["WEDNESDAY", "Mittwoch"],
  ["THURSDAY", "Donnerstag"],
  ["FRIDAY", "Freitag"],
  ["SATURDAY", "Samstag"],
  ["SUNDAY", "Sonntag"],
];
const EXTENSION_BATCH_OPTIONAL_FIELDS = [
  { key: "accessCentralPhoneBook", label: "Zentrales Telefonbuch", group: "Nebenstelle", type: "boolean", defaultValue: true, aliases: ["zentralesTelefonbuch", "centralPhonebook"] },
  { key: "phoneBookHide", label: "Im Telefonbuch ausblenden", group: "Nebenstelle", type: "boolean", defaultValue: false, aliases: ["telefonbuchAusblenden"] },
  { key: "language", label: "Sprache", group: "Nebenstelle", type: "text", defaultValue: "de", placeholder: "de", aliases: ["sprache"] },
  { key: "costCenter", label: "Kostenstelle", group: "Nebenstelle", type: "text", defaultValue: "", placeholder: "Kostenstelle", aliases: ["kostenstelle"] },
  { key: "callWaitingIndication", label: "Anklopfen", group: "Telefonie", type: "boolean", defaultValue: true },
  { key: "intercomEnabled", label: "Intercom", group: "Telefonie", type: "boolean", defaultValue: false },
  { key: "clirEnabled", label: "Rufnummernanzeige", group: "Telefonie", type: "text", defaultValue: "SHOW_BASE_NUMBER", placeholder: "SHOW_BASE_NUMBER" },
  { key: "recordingMode", label: "Aufzeichnungsmodus", group: "Telefonie", type: "text", defaultValue: "NEVER", placeholder: "NEVER" },
  { key: "ctiInfo", label: "CTI Info", group: "Telefonie", type: "text", defaultValue: "NONE", placeholder: "NONE" },
  { key: "clickToDialState", label: "Click-to-Dial", group: "Telefonie", type: "text", defaultValue: "DEFAULT", placeholder: "DEFAULT" },
  { key: "autodialTimeout", label: "Autodial Timeout", group: "Telefonie", type: "number", defaultValue: 0, placeholder: "0" },
  { key: "numberguessingLength", label: "Nummernlaenge", group: "Telefonie", type: "number", defaultValue: 0, placeholder: "0" },
  { key: "ncontrolEnabled", label: "Ncontrol", group: "Dienste", type: "boolean", defaultValue: false },
  { key: "ccbs", label: "Rueckruf bei besetzt", group: "Dienste", type: "boolean", defaultValue: true },
  { key: "replicateAgent", label: "Agent replizieren", group: "Dienste", type: "boolean", defaultValue: false },
  { key: "timeoutAfterSipTransfer", label: "Timeout nach SIP Transfer", group: "Dienste", type: "number", defaultValue: 0, placeholder: "0" },
  { key: "abandonOtherSoftphones", label: "Andere Softphones abmelden", group: "Dienste", type: "boolean", defaultValue: false },
  { key: "mediaGatewayEmergencyDialplanPriority", label: "Notruf-Dialplan", group: "Dienste", type: "text", defaultValue: "OFF", placeholder: "OFF" },
  { key: "dialPrefix", label: "Wahlpraefix", group: "Dienste", type: "text", defaultValue: "", placeholder: "Praefix" },
  { key: "nMeeting", label: "Nmeeting", group: "Dienste", type: "boolean", defaultValue: false },
  { key: "useTps", label: "TPS nutzen", group: "Dienste", type: "boolean", defaultValue: false },
  { key: "nhospitalityRoom", label: "Hospitality Room", group: "Dienste", type: "boolean", defaultValue: false },
  { key: "authorizeExternalByPin", label: "Extern per PIN autorisieren", group: "Rollen", type: "boolean", defaultValue: false },
  { key: "isCoach", label: "Coach", group: "Rollen", type: "boolean", defaultValue: false },
  { key: "isCoachee", label: "Coachee", group: "Rollen", type: "boolean", defaultValue: false },
  { key: "deskphoneCallTranscriptionNotificationEnabled", label: "Deskphone Transkript-Hinweis", group: "Rollen", type: "boolean", defaultValue: true },
  { key: "voicemailEmail", label: "Voicemail E-Mail", group: "Mailbox", type: "email", defaultValue: "", placeholder: "mail@example.de", aliases: ["email", "voicemail", "voicemail-email"] },
  { key: "announceCID", label: "Rufnummer ansagen", group: "Mailbox", type: "boolean", defaultValue: true },
  { key: "announceDateTime", label: "Datum/Zeit ansagen", group: "Mailbox", type: "boolean", defaultValue: true },
  { key: "sendEmail", label: "Mailbox per E-Mail senden", group: "Mailbox", type: "boolean", defaultValue: false },
  { key: "deleteAfterSending", label: "Mailbox nach Versand loeschen", group: "Mailbox", type: "boolean", defaultValue: false },
];
const EXTENSION_BATCH_FIELD_MAP = new Map(EXTENSION_BATCH_OPTIONAL_FIELDS.map((field) => [field.key, field]));
const EXTENSION_FIELD_LABELS = new Map([
  ["extensionNumber", "Nummer"],
  ["displayName", "Name"],
  ["targetType", "Typ"],
  ["href", "API Link"],
  ["voicemailHref", "Mailbox API Link"],
  ["voicemailNumber", "Mailbox Nummer"],
  ["device", "Geraet"],
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function safeFileTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function renderUiDialog() {
  const modal = $("#app-dialog-modal");
  if (!modal) return;
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
    cancelButton.textContent = uiDialog.cancelLabel || "Abbrechen";
    cancelButton.disabled = uiDialog.pending;
    cancelButton.hidden = uiDialog.pending || !uiDialog.showCancel;
  }
}

function closeUiDialog(value = false) {
  const resolve = uiDialog.resolve;
  uiDialog.open = false;
  uiDialog.pending = false;
  uiDialog.resolve = null;
  renderUiDialog();
  if (resolve) resolve(value);
}

function showUiDialog(options = {}) {
  if (uiDialog.resolve) closeUiDialog(false);
  Object.assign(uiDialog, {
    open: true,
    type: options.type || "info",
    title: options.title || "",
    message: options.message || "",
    confirmLabel: options.confirmLabel || "OK",
    cancelLabel: options.cancelLabel || "Abbrechen",
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

function confirmUi({ title, message, confirmLabel = "OK", cancelLabel = "Abbrechen", type = "confirm" }) {
  return showUiDialog({ title, message, confirmLabel, cancelLabel, type, showCancel: true });
}

function showUiNotice({ title, message, type = "error", confirmLabel = "OK" }) {
  return showUiDialog({ title, message, type, confirmLabel, showCancel: false });
}

function showUiProgress({ title, message }) {
  uiDialog.open = true;
  uiDialog.type = "pending";
  uiDialog.title = title || "Bitte warten";
  uiDialog.message = message || "Die Aktion wird ausgeführt.";
  uiDialog.confirmLabel = "OK";
  uiDialog.cancelLabel = "Abbrechen";
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
    success({ title: successTitle = "Erledigt", message: successMessage = "Die Aktion wurde abgeschlossen." } = {}) {
      uiDialog.open = true;
      uiDialog.pending = false;
      uiDialog.type = "success";
      uiDialog.title = successTitle;
      uiDialog.message = successMessage;
      uiDialog.confirmLabel = "OK";
      uiDialog.showCancel = false;
      renderUiDialog();
    },
    error({ title: errorTitle = "Aktion fehlgeschlagen", message: errorMessage = "Bitte erneut prüfen." } = {}) {
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
    return JSON.parse(localStorage.getItem(FLOW_LAYOUT_STORAGE_KEY) || "{}");
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
    const position = safeFlowPosition(saved.x, saved.y);
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
  localStorage.setItem(FLOW_LAYOUT_STORAGE_KEY, JSON.stringify(layouts));
}

function readStoredProfiles() {
  try {
    return JSON.parse(localStorage.getItem(FLOW_PROFILE_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveStoredProfiles(profiles) {
  localStorage.setItem(FLOW_PROFILE_STORAGE_KEY, JSON.stringify(profiles));
}

function readStoredFlowDrafts() {
  try {
    return JSON.parse(localStorage.getItem(FLOW_DRAFT_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveStoredFlowDrafts(drafts) {
  localStorage.setItem(FLOW_DRAFT_STORAGE_KEY, JSON.stringify(drafts));
}

function readStoredAppliedFlows() {
  try {
    return JSON.parse(localStorage.getItem(FLOW_APPLIED_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveStoredAppliedFlows(flows) {
  localStorage.setItem(FLOW_APPLIED_STORAGE_KEY, JSON.stringify(flows));
}

function flowDraftKey(did = selectedDid()) {
  const account = getOverview()?.account || "demo";
  const didId = did?.id || did?.name || state.selectedDidId || "default";
  return `${account}:${didId}`;
}

function normalizeCallflowStructure(flow) {
  if (!flow?.nodes?.length) return flow;
  const inbound = flow.nodes.find((node) => node.id === "inbound");
  const trunk = flow.nodes.find((node) => node.id === "trunk" || normalizeTargetType(node.type) === "TRUNK");
  if (!inbound || !trunk) return flow;

  const trunkLabel = trunk.subtitle || trunk.title || "";
  if (trunkLabel && !inbound.detail) inbound.detail = `über Leitung ${trunkLabel}`;

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
  node.subtitle = liveIvr.extensionNumber ? `Sprachdialog ${liveIvr.extensionNumber}` : node.subtitle;
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
  if (snapshotRoute && liveRoute && snapshotRoute !== liveRoute) return false;
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
  if (!flowOriginalMatchesDid(stored.flow.original, did)) return flow;
  if (flow?.liveVerifiedAt && stored.updatedAt && new Date(stored.updatedAt) <= new Date(flow.liveVerifiedAt)) {
    return flow;
  }
  if (flow?.appliedSnapshotAt && stored.updatedAt && new Date(stored.updatedAt) <= new Date(flow.appliedSnapshotAt)) {
    return flow;
  }
  normalizeCallflowStructure(stored.flow);
  return {
    ...flow,
    nodes: stored.flow.nodes,
    edges: stored.flow.edges || flow.edges,
    draftUpdatedAt: stored.updatedAt,
  };
}

function saveCurrentFlowDraft(showFeedback = true) {
  if (!state.flow?.nodes?.length) return;
  normalizeCallflowStructure(state.flow);
  const drafts = readStoredFlowDrafts();
  const updatedAt = new Date().toISOString();
  drafts[flowDraftKey()] = {
    updatedAt,
    did: selectedDid()?.name || "",
    flow: {
      source: state.flow.source,
      didId: state.flow.didId,
      original: state.flow.original,
      nodes: clone(state.flow.nodes),
      edges: clone(state.flow.edges || []),
    },
  };
  saveStoredFlowDrafts(drafts);
  state.flow.draftUpdatedAt = updatedAt;
  if (showFeedback) {
    state.flowFeedback = {
      ok: true,
      title: "Entwurf gespeichert",
      message: `Layout und Schritte wurden lokal gespeichert (${formatTime(updatedAt)}).`,
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
  state.flow = applyStoredAppliedFlow(baseFlow, did);
  state.selectedNodeId = "";
  state.selectedNodeIds = [];
  state.selectedBranchField = "";
  state.inspectorOpen = false;
  state.actionPlan = null;
  state.flowFeedback = {
    ok: true,
    title: "Lokaler Entwurf gelöscht",
    message: "Der Live-Zustand ist wieder die Grundlage.",
  };
}

function saveAppliedFlowSnapshot(flow, result, did = selectedDid()) {
  if (!flow?.nodes?.length || !did) return;
  const flows = readStoredAppliedFlows();
  const target = result?.target || {};
  const firstStep = (flow.nodes || []).find((node) => !node.locked && !node.branchTarget);
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
  const padding = 28;
  return {
    left: Math.max(0, (launcherRect.left - canvasRect.left + canvas.scrollLeft - padding) / zoom),
    right: Math.max(0, (launcherRect.right - canvasRect.left + canvas.scrollLeft + padding) / zoom),
    top: Math.max(0, (launcherRect.top - canvasRect.top + canvas.scrollTop - padding) / zoom),
    bottom: Math.max(0, (launcherRect.bottom - canvasRect.top + canvas.scrollTop + padding) / zoom),
  };
}

function safeFlowPosition(x, y) {
  const minX = (FLOW_CANVAS_EDGE_PADDING / FLOW_WORLD_WIDTH) * 100;
  const minY = (FLOW_SAFE_TOP / FLOW_POSITION_HEIGHT) * 100;
  let safeX = Math.max(Number(x) || minX, minX);
  let safeY = Math.max(Number(y) || minY, minY);
  const nodeLeft = (safeX / 100) * FLOW_WORLD_WIDTH;
  const nodeTop = (safeY / 100) * FLOW_POSITION_HEIGHT;
  const menuSafe = flowMenuSafeAreaWorld();
  const overlapsMenu = nodeLeft < menuSafe.right
    && nodeLeft + FLOW_NODE_WIDTH > menuSafe.left
    && nodeTop < menuSafe.bottom
    && nodeTop + FLOW_NODE_HEIGHT > menuSafe.top;
  if (overlapsMenu) {
    safeX = Math.max(safeX, ((menuSafe.right + FLOW_CANVAS_EDGE_PADDING) / FLOW_WORLD_WIDTH) * 100);
  }
  return {
    x: safeX,
    y: safeY,
  };
}

function clampFlowNodePosition(node) {
  if (!node) return;
  const position = safeFlowPosition(node.x, node.y);
  node.x = position.x;
  node.y = position.y;
}

function sanitizeFlowPositions(flow) {
  if (!flow?.nodes?.length) return flow;
  flow.nodes.forEach(clampFlowNodePosition);
  return flow;
}

function formatTime(value) {
  if (!value) return "noch nicht geprüft";
  return new Intl.DateTimeFormat("de-DE", {
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
  if (!dids.length) return false;
  return dids.every((did) => {
    const type = normalizeTargetType(did.destinationType);
    const name = String(did.destinationName || did.value || "");
    return type === "TIMECONTROL" && name.startsWith("TN ");
  });
}

function syncDaynightActiveFromOverview(overview = getOverview()) {
  const activeInPortal = overviewShowsManagedDaynightRouting(overview);
  if (state.daynightActive !== activeInPortal) {
    state.daynightActive = activeInPortal;
    localStorage.setItem(DAYNIGHT_ACTIVE_STORAGE_KEY, activeInPortal ? "1" : "0");
  }
}

function portalLiveWritesEnabled() {
  return Boolean(getOverview()?.settings?.liveWritesEnabled);
}

function liveWritesEnabled() {
  return portalLiveWritesEnabled() && !state.daynightActive;
}

function liveWritesDisabledText() {
  if (state.daynightActive) {
    return "Nachtmodus ist aktiv. Änderungen sind gesperrt, bis der Tagmodus wiederhergestellt wurde.";
  }
  return "Live-Schreiben ist im Setup deaktiviert. Dry-runs und Vorschauen bleiben aktiv.";
}

function setDaynightActive(active, modalMode = "") {
  state.daynightActive = Boolean(active);
  localStorage.setItem(DAYNIGHT_ACTIVE_STORAGE_KEY, state.daynightActive ? "1" : "0");
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
  const modalState = state.daynightModeModal;
  const mode = typeof modalState === "string" ? modalState : modalState?.mode;
  modal.hidden = !mode;
  modal.classList.toggle("is-open", Boolean(mode));
  if (!mode) return;
  const presets = {
    night: {
      symbol: "N",
      title: "Nachtmodus aktiv",
      message: "Die Rufnummern laufen jetzt über die vorbereiteten Zeitsteuerungen. Live-Änderungen in der App sind gesperrt.",
    },
    day: {
      symbol: "T",
      title: "Tagmodus aktiv",
      message: "Die Tagesziele wurden wiederhergestellt. Live-Änderungen sind wieder möglich.",
    },
    loading: {
      symbol: "...",
      title: "Bitte warten",
      message: "Die Portal API verarbeitet die Umschaltung. Das kann einen Moment dauern.",
    },
    setup: {
      symbol: "!",
      title: "Setup unvollständig",
      message: "Bitte erst in Setup den Standard sichern und den Zeitsteuerungs-Plan vollständig vorbereiten.",
    },
    error: {
      symbol: "!",
      title: "Umschaltung fehlgeschlagen",
      message: "Die Portal API konnte die Umschaltung nicht vollständig ausführen. Bitte Setup prüfen.",
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
}

function setDaynightOperationFeedback(result, fallbackTitle = "Aktion ausgeführt") {
  const details = [];
  if (Number.isFinite(result?.restoredRoutings)) {
    details.push(`${result.restoredRoutings} Rufnummer${result.restoredRoutings === 1 ? "" : "n"} zurückgestellt`);
  }
  if (Number.isFinite(result?.deletedTimeControls)) {
    details.push(`${result.deletedTimeControls} Zeitsteuerung${result.deletedTimeControls === 1 ? "" : "en"} gelöscht`);
  }
  if (Array.isArray(result?.deleted)) {
    details.push(`${result.deleted.length} alte Zeitsteuerung${result.deleted.length === 1 ? "" : "en"} gelöscht`);
  }
  if (Array.isArray(result?.results)) {
    const created = result.results.filter((item) => item.action === "create-daynight-gateway").length;
    const updated = result.results.filter((item) => item.action === "update-daynight-gateway").length;
    const skipped = result.results.filter((item) => item.skipped).length;
    const failed = result.results.filter((item) => item.ok === false).length;
    const failedItems = result.results.filter((item) => item.ok === false);
    if (created || updated || skipped) {
      details.push(`${created} angelegt, ${updated} aktualisiert, ${skipped} unverändert`);
    }
    if (failed) {
      details.push(`${failed} fehlgeschlagen`);
      details.push(...failedItems.slice(0, 3).map((item) => `${item.did || item.gateway || "Eintrag"}: ${item.error || item.message || "API-Fehler"}`));
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
      message: `${error.message || "Live-Aktion fehlgeschlagen"} Danach konnte der aktuelle Anlagenzustand nicht neu geladen werden: ${refreshError.message}`,
      blockers: [error.message || fallbackTitle, refreshError.message],
    };
  }
}

function endpointList() {
  return Object.entries(getOverview()?.endpoints || {});
}

function endpointIssues() {
  return endpointList().filter(([key, endpoint]) => !OPTIONAL_ENDPOINT_KEYS.has(key) && !endpoint.ok);
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
      links.push({ label: `Rufnummer ${did.name || did.id}`, detail: did.value || did.destinationName || "direktes Ziel" });
    }
  }
  for (const ivr of overview?.inventory?.ivrs || []) {
    for (const route of ivr.keyRoutes || []) {
      if (resourceMatchesTarget(kind, item, route.target)) {
        links.push({ label: `Sprachdialog ${ivr.name}`, detail: `Taste ${route.number}` });
      }
    }
    if (resourceMatchesTarget(kind, item, ivr.timeoutTarget)) {
      links.push({ label: `Sprachdialog ${ivr.name}`, detail: "Timeout" });
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

async function fetchJson(url, options = {}) {
  if (isUnsafeRequest(options)) await ensureCsrfToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      ...(isUnsafeRequest(options) ? { "X-CSRF-Token": state.csrfToken } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
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

async function loadCustomers() {
  if (state.customersLoading) return;
  state.customersLoading = true;
  state.customersError = "";
  renderSettingsSummary();
  try {
    const result = await fetchJson("/api/customers");
    state.customers = result.customers || [];
    state.customersError = result.ok ? "" : result.error || "";
  } catch (error) {
    state.customersError = error.message;
    state.customers = [];
  } finally {
    state.customersLoading = false;
    renderSettingsSummary();
  }
}

function resetAccountScopedState() {
  state.overview = null;
  state.flow = null;
  state.selectedExtensionId = "";
  state.selectedDidId = "";
  state.selectedNodeId = "";
  state.selectedNodeIds = [];
  state.selectedBranchField = "";
  state.actionPlan = null;
  state.daynightGatewayPreview = null;
  state.daynightOperationFeedback = null;
  state.profileTargetValue = "";
  state.daynightAnnouncementName = "";
  state.daynightAnnouncementAfterValue = "";
  state.daynightAnnouncementDisplayName = "";
  state.daynightUseAnnouncement = false;
  state.daynightAnnouncementSource = "existing";
  state.serviceGroups = null;
  state.serviceDraft = null;
  state.serviceDraftHistory = [];
  state.selectedServiceKey = "";
  state.serviceFeedback = null;
}

async function switchCustomer(account) {
  const currentAccount = getOverview()?.account || "";
  if (!account || account === currentAccount || state.customerSwitching) return;
  state.customerSwitching = true;
  state.error = "";
  state.customerSwitchFeedback = `Prüfe Anlage ${account}...`;
  renderSettingsSummary();
  try {
    const result = await fetchJson("/api/settings/customer", {
      method: "POST",
      body: JSON.stringify({ account }),
    });
    state.customers = result.customers || state.customers;
    if (!state.customers.some((customer) => customer.account === result.account)) {
      state.customers = [
        ...state.customers,
        { account: result.account, name: result.customer?.name || result.account, label: result.customer?.label || result.account },
      ];
    }
    state.customerSwitchFeedback = result.message || `Anlage ${result.account} ist aktiv.`;
    state.manualCustomerAccount = "";
    resetAccountScopedState();
    await loadOverview();
  } catch (error) {
    state.customerSwitchFeedback = error.message;
    render();
  } finally {
    state.customerSwitching = false;
    renderSettingsSummary();
  }
}

async function loadOverview() {
  state.loading = true;
  state.error = "";
  renderStatus();

  try {
    const overview = await fetchJson("/api/overview");
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
    state.flow = applyStoredFlowDraft(applyStoredAppliedFlow(baseFlow, selectedDid()), selectedDid());
    state.selectedNodeId = "";
    state.selectedNodeIds = [];
    state.inspectorOpen = false;
    state.selectedBranchField = "";
  } catch (error) {
    state.error = error.message;
  } finally {
    state.loading = false;
    render();
    if (!state.serviceGroups && !state.serviceLoading) {
      loadServiceGroups({ quiet: true });
    }
  }
}

async function setLiveWritesEnabled(enabled) {
  if (state.liveWritesSaving) return;

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
    showUiNotice({ title: "Einstellung nicht gespeichert", message: error.message });
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
  if (extension) parts.push(`Nebenstelle ${extension}`);
  if (service && service !== extension) parts.push(`Service ${service}`);
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
    const name = member.name || "Nebenstelle";
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
  const candidates = state.serviceGroups?.[serviceCollectionFromKind(kind)] || [];
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
    return JSON.parse(localStorage.getItem(serviceDraftStorageKey()) || "null");
  } catch {
    return null;
  }
}

function writeStoredServiceDraft(draft) {
  localStorage.setItem(serviceDraftStorageKey(), JSON.stringify(draft));
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
    state.serviceFeedback = { type: "info", title: "Nichts rückgängig", message: "Es gibt keine lokale Änderung zum Zurücknehmen." };
    renderServices();
    return;
  }
  state.serviceDraft = previous;
  writeStoredServiceDraft(state.serviceDraft);
  refreshFlowServiceNodeMeta();
  state.serviceFeedback = { type: "info", title: "Rückgängig", message: "Die letzte lokale Änderung wurde zurückgenommen." };
  renderServices();
  if (state.view === "callflow") renderCallflow();
}

function memberFromExtension(extension, kind) {
  return {
    extensionNumber: extension.number || extension.id,
    name: extension.name || `Nebenstelle ${extension.number || extension.id}`,
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

function ensureServiceDraft() {
  if (!state.serviceDraft) {
    state.serviceDraft = readStoredServiceDraft() || buildServiceDraft();
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
  const quiet = Boolean(options.quiet);
  state.serviceLoading = true;
  if (!quiet) {
    state.serviceFeedback = { type: "info", title: "Lädt", message: "Warteschlangen und Skillgruppen werden aus der Portal API gelesen." };
    renderServices();
  }
  try {
    const groups = await fetchJson("/api/service-groups");
    state.serviceGroups = groups;
    state.serviceDraft = readStoredServiceDraft() || buildServiceDraft(groups);
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
    if (!quiet || state.view === "services") {
      state.serviceFeedback = { type: "error", title: "Laden fehlgeschlagen", message: error.message };
    }
  } finally {
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
  if (!service) return;
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
    title: added ? "Entwurf geändert" : "Keine Änderung",
    message: added
      ? `${added} Nebenstelle${added === 1 ? "" : "n"} ${added === 1 ? "ist" : "sind"} für ${service.name} vorgemerkt.`
      : "Die gewählten Nebenstellen waren bereits enthalten.",
  };
  writeStoredServiceDraft(state.serviceDraft);
  renderServices();
}

function removeServiceMember(kind, serviceId, extensionNumber) {
  const services = state.serviceGroups?.[serviceCollectionFromKind(kind)] || [];
  const service = services.find((item) => String(item.serviceNumber || item.id || item.value) === String(serviceId));
  if (!service) return;
  const entry = serviceDraftEntry(kind, service);
  const nextMembers = (entry.members || []).filter((member) => String(member.extensionNumber) !== String(extensionNumber));
  if (nextMembers.length === (entry.members || []).length) return;
  rememberServiceDraftChange();
  entry.members = nextMembers;
  state.serviceFeedback = { type: "info", title: "Entwurf geändert", message: "Mitgliedschaft wird beim Übernehmen entfernt." };
  writeStoredServiceDraft(state.serviceDraft);
  renderServices();
}

function updateServiceMember(kind, serviceId, extensionNumber, patch) {
  const services = state.serviceGroups?.[serviceCollectionFromKind(kind)] || [];
  const service = services.find((item) => String(item.serviceNumber || item.id || item.value) === String(serviceId));
  if (!service) return;
  const entry = serviceDraftEntry(kind, service);
  const member = (entry.members || []).find((item) => String(item.extensionNumber) === String(extensionNumber));
  if (!member) return;
  const hasChange = Object.entries(patch).some(([key, value]) => member[key] !== value);
  if (!hasChange) return;
  rememberServiceDraftChange();
  Object.assign(member, patch);
  state.serviceFeedback = { type: "info", title: "Entwurf geändert", message: "Mitgliedschaftseinstellung vorgemerkt." };
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
  state.serviceFeedback = { type: "info", title: "Farbe gespeichert", message: "Die Farbe wird im Gruppenbereich und im Callflow gespiegelt." };
  writeStoredServiceDraft(state.serviceDraft);
  renderServices();
  if (state.view === "callflow") renderCallflow();
}

function validateServiceDraft(showSuccess = true) {
  const groups = state.serviceGroups;
  if (!groups) return { ok: false, message: "Noch keine Service-Daten geladen." };
  const allServices = [
    ...(groups.queues || []).map((service) => ({ kind: "queue", service })),
    ...(groups.skills || []).map((service) => ({ kind: "skill", service })),
  ];
  const changed = allServices.filter(({ kind, service }) => serviceHasChanges(kind, service));
  if (!changed.length) {
    state.serviceFeedback = { type: "info", title: "Keine Änderung", message: "Der Entwurf entspricht dem Live-Stand." };
    renderServices();
    return { ok: false, message: "Keine Änderung." };
  }
  const emptyService = changed.find(({ kind, service }) => !(serviceDraftEntry(kind, service).members || []).length);
  if (emptyService) {
    state.serviceFeedback = { type: "error", title: "Prüfung fehlgeschlagen", message: `${emptyService.service.name} hätte danach keine Mitglieder.` };
    renderServices();
    return { ok: false, message: "Leere Zielgruppe." };
  }
  if (showSuccess) {
    state.serviceFeedback = { type: "success", title: "Entwurf bereit", message: `${changed.length} Service${changed.length === 1 ? "" : "s"} mit geänderten Mitgliedschaften.` };
    renderServices();
  }
  return { ok: true, changed };
}

async function applyServiceDraft() {
  if (!liveWritesEnabled()) {
    state.serviceFeedback = { type: "error", title: "Live-Schreiben deaktiviert", message: liveWritesDisabledText() };
    renderServices();
    return;
  }
  const validation = validateServiceDraft(false);
  if (!validation.ok) return;
  state.serviceFeedback = { type: "info", title: "Übernahme läuft", message: "Portal API aktualisiert Mitgliedschaften." };
  renderServices();
  const payload = {
    services: validation.changed.map(({ kind, service }) => {
      const entry = serviceDraftEntry(kind, service);
      return {
        kind,
        serviceNumber: entry.serviceNumber,
        members: entry.members,
      };
    }),
  };
  try {
    const result = await fetchJson("/api/service-groups/apply", { method: "POST", body: JSON.stringify(payload) });
    if (result.overview) state.overview = result.overview;
    state.serviceGroups = result.serviceGroups;
    state.serviceDraft = buildServiceDraft(result.serviceGroups);
    state.serviceDraftHistory = [];
    writeStoredServiceDraft(state.serviceDraft);
    state.serviceFeedback = { type: "success", title: result.title || "Übernommen", message: result.message || "Änderungen übernommen." };
    render();
  } catch (error) {
    state.serviceFeedback = { type: "error", title: "Übernahme fehlgeschlagen", message: error.message };
    renderServices();
  }
}

function buildDemoOverview(base = {}) {
  const extensions = [
    { id: "201", number: "201", name: "Reception", type: "PHONE", email: "reception@example.local", device: "Yealink T54W" },
    { id: "202", number: "202", name: "Sales", type: "PHONE", email: "sales@example.local", device: "Softphone" },
    { id: "203", number: "203", name: "Support", type: "PHONE", email: "support@example.local", device: "Yealink T46S" },
  ];
  const overview = {
    ...base,
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
      ivrs: [{ id: "20", name: "Welcome Sprachdialog" }],
      timeControls: [{ id: "30", name: "Business Hours" }],
      announcements: [{ id: "40", name: "Nachtansage", value: "GENERAL_ANNOUNCEMENT" }],
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
    PHONEEXTENSION: "Nebenstelle",
    PHONE: "Nebenstelle",
    QUEUE: "Warteschlange",
    GROUP: "Skillgruppe",
    SKILL: "Skillgruppe",
    VOICEMAIL: "Anrufbeantworter",
    FRONTDESK: "Frontdesk",
    IVR: "Sprachdialog",
    TIMECONTROL: "Zeitsteuerung",
    ANNOUNCEMENT: "Ansage",
    HANGUP: "Auflegen",
    NEW_NIGHT_TARGET: "Neues Nachtziel",
    PLACEHOLDER: "Offener Schritt",
    UNASSIGNED: "Kein Ziel",
    TRUNK: "Leitung",
  };
  return labels[String(type || "").toUpperCase()] || "Ziel";
}

function displayTargetName(type, name) {
  return String(name || "");
}

function targetNumberFromText(value) {
  const match = String(value || "").match(/\b\d{1,8}\b/);
  return match ? match[0] : "";
}

function targetOptionLabel(number, type, name) {
  return `${number || "-"} - (${targetTypeLabel(type)} | ${displayTargetName(type, name) || "ohne Name"})`;
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
  return a.number - b.number || a.type - b.type || a.title.localeCompare(b.title, "de");
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
  ["serviceKind", "serviceColor", "serviceAccent", "serviceSoft", "memberCount", "memberNames", "memberTargets"].forEach((key) => {
    if (target[key] !== undefined && target[key] !== "") normalized[key] = target[key];
  });
  if (type === "Sprachdialog") {
    const liveIvr = inventoryIvrForTarget(target, routeNumber, targetNumber);
    const liveKey = ivrInventoryKey(liveIvr);
    if (liveIvr && liveKey && !seenIvrs.has(liveKey)) {
      normalized.title = liveIvr.name || normalized.title;
      normalized.subtitle = liveIvr.extensionNumber ? `Sprachdialog ${liveIvr.extensionNumber}` : normalized.subtitle;
      normalized.targetNumber = liveIvr.extensionNumber || normalized.targetNumber;
      normalized.routeNumber = liveIvr.serviceNumber || normalized.routeNumber;
      normalized.config = liveIvrConfig(liveIvr, seenIvrs);
    }
  }
  return normalized;
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
  if (currentKey) nextSeenIvrs.add(currentKey);
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

function buildFlowForDid(did, overview) {
  const selected = did || overview?.inventory?.dids?.[0] || {};
  const trunk = selected.trunkNumber || overview?.inventory?.trunks?.[0]?.name || "SIP Trunk";
  const destinationTitle = selected.destinationName || selected.value || selected.destinationExtension || "Ziel wählen";
  const destinationSubtitle = selected.destinationExtension
    ? `${targetTypeLabel(selected.destinationType)} ${selected.destinationExtension}`
    : targetTypeLabel(selected.destinationType);
  const liveIvr = liveIvrForDid(selected, overview);
  const isLiveIvr = normalizeTargetType(selected.destinationType) === "IVR" && Boolean(liveIvr);
  const liveIvrTitle = liveIvr?.name || destinationTitle;
  const targetNode = isLiveIvr
    ? {
      id: "target",
      type: "IVR",
      title: liveIvrTitle,
      subtitle: destinationSubtitle,
      targetNumber: selected.destinationExtension || liveIvr.extensionNumber || "",
      routeNumber: selected.destinationServiceNumber || liveIvr.serviceNumber || selected.destinationExtension || "",
      x: 46,
      y: 54,
      tone: targetTone("IVR"),
      config: liveIvrConfig(liveIvr),
    }
    : {
      id: "target",
      type: selected.destinationType || "PHONEEXTENSION",
      title: destinationTitle,
      subtitle: destinationSubtitle,
      targetNumber: selected.destinationExtension || "",
      routeNumber: selected.destinationServiceNumber || selected.destinationExtension || "",
      x: 46,
      y: 54,
      tone: targetTone(selected.destinationType),
      isTarget: true,
    };
  return {
    source: overview?.demo ? "demo" : "portal-live",
    didId: selected.id || selected.name || "did",
    liveVerifiedAt: isLiveIvr ? overview?.syncedAt : "",
    original: {
      did: selected.name || selected.id || "Rufnummer",
      destinationName: selected.destinationName || selected.value || "",
      destinationExtension: selected.destinationExtension || "",
      destinationType: selected.destinationType || "",
    },
    nodes: [
      { id: "inbound", type: "DID", title: "Eingehender Anruf", subtitle: selected.name || selected.id || "Rufnummer", detail: `über Leitung ${trunk}`, x: 46, y: 24, tone: "indigo", locked: true },
      targetNode,
    ],
    edges: [
      { from: "inbound", to: "target", label: "führt zu" },
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

function renderHeader() {
  const overview = getOverview();
  const account = visibleAccount(overview);
  $("#account-label").textContent = overview
    ? `${account || "Login erforderlich"} · geprüft ${formatTime(overview.syncedAt)}`
    : "Telefonie-Daten ansehen und Änderungen vorbereiten";
  const demoToggle = $("#demo-toggle");
  if (demoToggle) demoToggle.checked = state.demoMode;
  renderSettingsSummary();
  renderAuthLoginPanel();
}

function renderStatus() {
  const connection = $("#connection-state");
  if (!connection) return;

  connection.className = "connection";
  connection.removeAttribute("title");

  if (state.loading) {
    connection.textContent = "Prüft";
    return;
  }
  if (state.error) {
    connection.classList.add("is-error");
    connection.textContent = "Fehler";
    connection.title = state.error;
    return;
  }

  const issues = endpointIssues();
  const overview = getOverview();
  if (overview?.demo || state.demoMode) {
    connection.classList.add("is-warning");
    connection.textContent = "Demo";
    connection.title = "Demo-Daten aktiv";
  } else if (issues.length) {
    connection.classList.add("is-warning");
    connection.textContent = "API teilweise geladen";
    connection.title = `${issues.length} technischer API-Bereich${issues.length === 1 ? "" : "e"} konnte${issues.length === 1 ? "" : "n"} nicht geladen werden. Details stehen unter Setup.`;
  } else {
    connection.classList.add("is-online");
    connection.textContent = "Bereit";
    connection.title = "Portal API erreichbar";
  }
}

function renderMetrics() {
  const overview = getOverview();
  const issues = endpointIssues().length;
  const statMetrics = [
    { label: "Nebenstellen", value: overview?.counts?.extensions ?? "-" },
    { label: "Rufnummern", value: overview?.counts?.dids ?? "-" },
    { label: "Geräte", value: overview?.counts?.devices ?? "-" },
    { label: "Hinweise", value: issues },
  ];
  const resourceMetrics = [
    { label: "Warteschlangen", value: overview?.counts?.queues ?? "-", resource: "queues" },
    { label: "Skillgruppen", value: overview?.counts?.skills ?? "-", resource: "skills" },
    { label: "Sprachdialoge", value: overview?.counts?.ivrs ?? "-", resource: "ivrs" },
    { label: "Zeitsteuerungen", value: overview?.counts?.timeControls ?? "-", resource: "timeControls" },
  ].concat(
    overview?.endpoints?.frontdesks?.ok
      ? [{ label: "Frontdesk/Nia", value: overview?.counts?.frontdesks ?? "-", resource: "frontdesks" }]
      : []
  );
  const renderMetric = (metric) => `
    <button class="metric ${metric.resource ? "is-resource" : ""}" type="button" data-metric="${escapeHtml(metric.label)}" ${metric.resource ? `data-resource-kind="${escapeHtml(metric.resource)}"` : ""}>
      <span class="metric-label">${escapeHtml(metric.label)}</span>
      <strong>${escapeHtml(metric.value)}</strong>
    </button>
  `;

  $("#metrics").innerHTML = `
    <div class="metric-group" aria-label="Statistiken">
      <span class="metric-group-title">Statistiken</span>
      <div class="metric-grid">${statMetrics.map(renderMetric).join("")}</div>
    </div>
    <div class="metric-group is-interactive" aria-label="Portal-Ressourcen">
      <span class="metric-group-title">Portal-Ressourcen</span>
      <div class="metric-grid">${resourceMetrics.map(renderMetric).join("")}</div>
    </div>
  `;
}

function openResourceModal(kind) {
  if (!RESOURCE_DEFS[kind]) return;
  state.resourceModalKind = kind;
  renderResourceModal();
}

function closeResourceModal() {
  state.resourceModalKind = "";
  state.resourceDeleting = "";
  renderResourceModal();
}

function openResourceCreateModal(kind) {
  if (!RESOURCE_DEFS[kind]) return;
  state.resourceCreateKind = kind;
  state.resourceCreating = false;
  renderResourceCreateModal();
}

function closeResourceCreateModal() {
  state.resourceCreateKind = "";
  state.resourceCreating = false;
  renderResourceCreateModal();
}

function renderResourceModal() {
  const modal = $("#resource-modal");
  if (!modal) return;
  const kind = state.resourceModalKind;
  const def = RESOURCE_DEFS[kind];
  modal.classList.toggle("is-open", Boolean(def));
  modal.setAttribute("aria-hidden", def ? "false" : "true");
  if (!def) return;

  const writesEnabled = liveWritesEnabled();
  const items = resourceItems(kind);
  $("#resource-modal-title").textContent = def.label;
  $("#resource-modal-subtitle").textContent = writesEnabled
    ? `${items.length} Eintrag${items.length === 1 ? "" : "e"} aus der Portal API`
    : `${items.length} Eintrag${items.length === 1 ? "" : "e"} aus der Portal API · Live-Schreiben deaktiviert`;
  const list = items.length ? items.map((item) => {
    const id = resourceNumber(item);
    const extension = resourceExtension(item);
    const links = resourceConnections(kind, item);
    const deleting = state.resourceDeleting === `${kind}:${id}`;
    return `
      <article class="resource-item">
        <div class="resource-item-main">
          <span class="resource-type">${escapeHtml(def.itemLabel)}</span>
          <strong>${escapeHtml(item.name || id || def.itemLabel)}</strong>
          <span>${escapeHtml([
            id ? `Service ${id}` : "",
            extension && extension !== id ? `Nebenstelle ${extension}` : "",
          ].filter(Boolean).join(" · ") || "Keine Nummer erkannt")}</span>
        </div>
        <div class="resource-links">
          <span>Verbunden mit</span>
          ${links.length ? links.map((link) => `
            <div class="resource-link">
              <strong>${escapeHtml(link.label)}</strong>
              <small>${escapeHtml(link.detail)}</small>
            </div>
          `).join("") : `<div class="empty-state is-compact">Keine Verknüpfung erkannt.</div>`}
        </div>
        <button class="secondary-button resource-delete" data-delete-resource-kind="${escapeHtml(kind)}" data-delete-resource-id="${escapeHtml(id)}" type="button" ${id && !deleting && writesEnabled ? "" : "disabled"}>
          ${!writesEnabled ? "Gesperrt" : deleting ? "Lösche..." : "Löschen"}
        </button>
      </article>
    `;
  }).join("") : `<div class="empty-state">Keine ${escapeHtml(def.label)} gefunden.</div>`;
  $("#resource-modal-body").innerHTML = `
    <div class="resource-toolbar">
      <button class="primary-button" data-open-resource-create="${escapeHtml(kind)}" type="button" ${writesEnabled ? "" : "disabled"}>${escapeHtml(def.itemLabel)} anlegen</button>
      ${writesEnabled ? "" : `<span class="plan-note">${escapeHtml(liveWritesDisabledText())}</span>`}
    </div>
    ${list}
  `;
}

function targetSelectMarkup(name, required = false) {
  const options = targetOptions();
  return `
    <span class="select-search-stack">
      <input class="select-filter-input" type="search" placeholder="Ziel suchen..." aria-label="Ziel suchen">
      <select name="${escapeHtml(name)}" ${required ? "required" : ""}>
        <option value="">Ziel wählen</option>
        <option value="${escapeHtml(JSON.stringify({ type: "HANGUP", title: "Auflegen", routeNumber: "HANGUP", number: "HANGUP" }))}">Auflegen</option>
        ${options.map((target) => `<option value="${escapeHtml(target.value)}">${escapeHtml(target.label)}</option>`).join("")}
      </select>
    </span>
  `;
}

function announcementSelectMarkup() {
  const announcements = getOverview()?.inventory?.announcements || [];
  return `
    <span class="select-search-stack">
      <input class="select-filter-input" type="search" placeholder="Ansage suchen..." aria-label="Ansage suchen">
      <select name="announcementName" required>
        <option value="">Ansage wählen</option>
        ${announcements.map((announcement) => {
          const value = announcement.name || announcement.value || announcement.id;
          return `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`;
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

  $("#resource-create-title").textContent = `${def.itemLabel} anlegen`;
  const writesEnabled = liveWritesEnabled();
  $("#resource-create-subtitle").textContent = writesEnabled ? "Live-Anlage in der Portal API" : "Live-Anlage ist in dieser Umgebung deaktiviert";
  $("#resource-create-body").innerHTML = `
    <form class="resource-create-form" id="resource-create-form" data-resource-create-kind="${escapeHtml(kind)}">
      <div class="field-grid">
        <label class="field-control">Name
          <input name="displayName" required maxlength="50" placeholder="${escapeHtml(def.itemLabel)} Name">
        </label>
        <label class="field-control">Service-Nummer
          <input name="serviceNumber" inputmode="numeric" placeholder="${kind === "queues" || kind === "skills" ? "optional" : "automatisch, falls leer"}">
        </label>
        <label class="field-control">Nebenstelle
          <input name="extensionNumber" inputmode="numeric" placeholder="${kind === "queues" || kind === "skills" ? "optional" : "automatisch, falls leer"}">
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
            <select name="fromDay">${WEEKDAY_OPTIONS.map(([value, label]) => `<option value="${value}" ${value === "MONDAY" ? "selected" : ""}>${label}</option>`).join("")}</select>
          </label>
          <label class="field-control">Von Uhrzeit
            <input name="fromTime" type="time" value="08:00">
          </label>
          <label class="field-control">Bis Tag
            <select name="toDay">${WEEKDAY_OPTIONS.map(([value, label]) => `<option value="${value}" ${value === "FRIDAY" ? "selected" : ""}>${label}</option>`).join("")}</select>
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
        <button class="secondary-button" data-close-resource-create type="button">Abbrechen</button>
        <button class="primary-button" data-create-resource-submit type="submit" ${state.resourceCreating || !writesEnabled ? "disabled" : ""}>${!writesEnabled ? "Gesperrt" : state.resourceCreating ? "Lege an..." : "Live anlegen"}</button>
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
  if (!RESOURCE_DEFS[kind]) return;
  if (!liveWritesEnabled()) {
    showUiNotice({ title: "Live-Schreiben deaktiviert", message: liveWritesDisabledText(), type: "warning" });
    return;
  }
  const payload = resourceCreatePayload(form);
  const progress = showUiProgress({ title: `${RESOURCE_DEFS[kind].itemLabel} wird angelegt`, message: "Portal API legt die Ressource live an." });
  state.resourceCreating = true;
  renderResourceCreateModal();
  try {
    await fetchJson(`/api/resources/${encodeURIComponent(kind)}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    await loadOverview();
    state.resourceModalKind = kind;
    state.resourceCreateKind = "";
    state.resourceCreating = false;
    render();
    renderResourceModal();
    renderResourceCreateModal();
    progress.success({ title: `${RESOURCE_DEFS[kind].itemLabel} angelegt`, message: "Die Ressource wurde live erstellt." });
  } catch (error) {
    state.resourceCreating = false;
    renderResourceCreateModal();
    progress.error({ title: "Ressource nicht angelegt", message: error.message });
  }
}

function serviceCreateCardMarkup(kind) {
  const collection = serviceCollectionFromKind(kind);
  const label = kind === "skill" ? "Skillgruppe" : "Warteschlange";
  const draft = serviceCreateDraftFor(kind);
  const creating = state.serviceCreating === kind;
  const disabled = creating || !liveWritesEnabled();
  return `
    <form class="service-create-card" data-service-create-kind="${escapeHtml(kind)}">
      <div class="service-create-title">
        <span class="service-kind">${escapeHtml(label)}</span>
        <strong>${escapeHtml(label)} anlegen</strong>
      </div>
      <div class="service-create-fields">
        <label>Name
          <input name="displayName" data-service-create-field="displayName" value="${escapeHtml(draft.displayName || "")}" maxlength="50" placeholder="${escapeHtml(label)} Name" required>
        </label>
        <label>Nebenstelle
          <input name="extensionNumber" data-service-create-field="extensionNumber" value="${escapeHtml(draft.extensionNumber || "")}" inputmode="numeric" placeholder="optional">
        </label>
      </div>
      <button class="primary-button" type="submit" ${disabled ? "disabled" : ""}>
        ${!liveWritesEnabled() ? "Live-Schreiben gesperrt" : creating ? "Lege an..." : `${escapeHtml(label)} anlegen`}
      </button>
      ${!liveWritesEnabled() ? `<span class="plan-note">${escapeHtml(liveWritesDisabledText())}</span>` : ""}
      <input type="hidden" name="resourceKind" value="${escapeHtml(collection)}">
    </form>
  `;
}

async function createServiceGroup(kind) {
  const collection = serviceCollectionFromKind(kind);
  const label = kind === "skill" ? "Skillgruppe" : "Warteschlange";
  const draft = serviceCreateDraftFor(kind);
  const displayName = String(draft.displayName || "").trim();
  if (!displayName) {
    state.serviceFeedback = { type: "error", title: `${label} nicht angelegt`, message: "Bitte einen Namen eingeben." };
    renderServices();
    return;
  }
  if (!liveWritesEnabled()) {
    state.serviceFeedback = { type: "error", title: "Live-Schreiben deaktiviert", message: liveWritesDisabledText() };
    renderServices();
    return;
  }
  state.serviceCreating = kind;
  state.serviceFeedback = { type: "info", title: `${label} wird angelegt`, message: "Portal API erstellt den neuen Eintrag." };
  renderServices();
  try {
    await fetchJson(`/api/resources/${encodeURIComponent(collection)}`, {
      method: "POST",
      body: JSON.stringify({
        displayName,
        serviceNumber: String(draft.serviceNumber || "").trim(),
        extensionNumber: String(draft.extensionNumber || "").trim(),
      }),
    });
    resetServiceCreateDraft(kind);
    state.serviceGroups = null;
    state.serviceDraft = null;
    state.serviceDraftHistory = [];
    state.selectedServiceKey = "";
    state.serviceInspectorOpen = false;
    state.serviceFeedback = { type: "success", title: `${label} angelegt`, message: "Bestand wurde neu geladen." };
    await loadOverview();
    await loadServiceGroups({ quiet: true });
    state.serviceFeedback = { type: "success", title: `${label} angelegt`, message: "Bestand wurde neu geladen." };
  } catch (error) {
    state.serviceFeedback = { type: "error", title: `${label} konnte nicht angelegt werden`, message: error.message };
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
  if (!liveWritesEnabled()) {
    showUiNotice({ title: "Live-Schreiben deaktiviert", message: liveWritesDisabledText(), type: "warning" });
    return;
  }
  const links = resourceConnections(kind, item);
  const warning = links.length
    ? `\n\nDiese Ressource ist noch ${links.length}x verbunden. Die Portal API kann das Löschen ablehnen.`
    : "";
  const confirmed = await confirmUi({
    title: `${def.itemLabel} löschen`,
    message: `${def.itemLabel} "${item.name || id}" wirklich live löschen?${warning}`,
    confirmLabel: "Löschen",
    type: "warning",
  });
  if (!confirmed) return;

  const progress = showUiProgress({ title: `${def.itemLabel} wird gelöscht`, message: "Portal API verarbeitet die Löschung." });
  state.resourceDeleting = `${kind}:${id}`;
  renderResourceModal();
  try {
    await fetchJson(`/api/resources/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadOverview();
    state.resourceModalKind = kind;
    state.resourceDeleting = "";
    render();
    renderResourceModal();
    progress.success({ title: `${def.itemLabel} gelöscht`, message: "Die Ressource wurde live entfernt." });
  } catch (error) {
    state.resourceDeleting = "";
    renderResourceModal();
    progress.error({ title: "Löschen fehlgeschlagen", message: error.message });
  }
}

function renderSummary() {
  const overviewSummary = $("#overview-summary");
  if (overviewSummary) overviewSummary.innerHTML = "";
}

function renderRoutingPreview() {
  const dids = getOverview()?.inventory?.dids || [];
  const preview = dids.slice(0, 8);
  if (!preview.length) {
    $("#routing-preview").innerHTML = `<div class="empty-state">Keine Rufnummern-Ziele gefunden.</div>`;
    return;
  }

  $("#routing-preview").innerHTML = preview.map((did) => `
    <div class="routing-item">
      <strong>${escapeHtml(did.name)}</strong>
      <span>führt zu</span>
      <b>${escapeHtml(did.value || "kein Ziel erkannt")}</b>
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
      relations.push({ label: "Rufnummer", detail: `${did.name || did.id || "Rufnummer"} -> ${did.value || did.destinationName || number}` });
    }
  }
  for (const queue of overview?.inventory?.queues || []) {
    const members = queue.members || [];
    if (members.some((member) => String(member.extensionNumber || member.number || member.id || "") === number)) {
      relations.push({ label: "Warteschlange", detail: queue.name || queue.serviceNumber || queue.extensionNumber || "Warteschlange" });
    }
  }
  for (const skill of overview?.inventory?.skills || []) {
    const members = skill.members || [];
    if (members.some((member) => String(member.extensionNumber || member.number || member.id || "") === number)) {
      relations.push({ label: "Skillgruppe", detail: skill.name || skill.serviceNumber || skill.extensionNumber || "Skillgruppe" });
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
        <span>Bestand</span>
        <strong>${escapeHtml(extensions.length)}</strong>
        <small>Nebenstellen aus der Portal API</small>
      </div>
      <div class="sync-stat">
        <span>Geräte</span>
        <strong>${escapeHtml(withDevice)}</strong>
        <small>zugeordnet</small>
      </div>
      <div class="sync-stat">
        <span>Auswahl</span>
        <strong>${escapeHtml(selected?.number || "-")}</strong>
        <small>${escapeHtml(selected?.name || "keine Nebenstelle")}</small>
      </div>
      <div class="sync-stat">
        <span>Verknüpft</span>
        <strong>${escapeHtml(extensionRelations(selected).length)}</strong>
        <small>erkannte Bezüge</small>
      </div>
    </div>
  `;
}

function renderExtensions() {
  const visible = filteredExtensions();
  if (!visible.length) {
    $("#extension-list").innerHTML = `<div class="empty-state">Keine Nebenstelle gefunden.</div>`;
    return;
  }

  $("#extension-list").innerHTML = `
    <div class="extension-table">
      <div class="extension-head" aria-hidden="true">
        <span>Name</span>
        <span>Nebenstelle</span>
        <span>Typ</span>
        <span></span>
      </div>
      ${visible.map((extension) => `
        <button class="extension-row ${extension.id === state.selectedExtensionId ? "is-selected" : ""}" type="button" data-extension-id="${escapeHtml(extension.id)}">
          <span>
            <span class="extension-name">${escapeHtml(extension.name)}</span>
            <span class="extension-meta">${escapeHtml(extension.device || "nicht zugeordnet")}</span>
          </span>
          <span class="extension-number">${escapeHtml(extension.number)}</span>
          <span class="extension-type">${escapeHtml(extension.type || "PHONE")}</span>
          <span class="extension-action">Auswählen</span>
        </button>
      `).join("")}
    </div>
  `;
}

function renderExtensionDetail() {
  const extension = selectedExtension();
  if (!extension) {
    $("#extension-detail").innerHTML = `<div class="empty-state">Wähle eine Nebenstelle aus.</div>`;
    return;
  }

  const deviceStatus = extension.device ? "Gerät zugeordnet" : "kein Gerät zugeordnet";
  const relations = extensionRelations(extension);
  const usedFields = extensionUsedFieldEntries(extension);

  $("#extension-detail").innerHTML = `
    <div class="selected-title">
      <span class="extension-number">${escapeHtml(extension.number)}</span>
      <div>
        <strong>${escapeHtml(extension.name)}</strong>
        <span>${escapeHtml(extension.type || "Nebenstelle")}</span>
      </div>
    </div>

    <div class="field-grid">
      <div class="field"><span>Name</span><strong>${escapeHtml(extension.name)}</strong></div>
      <div class="field"><span>Gerät</span><strong>${escapeHtml(extension.device || "nicht zugeordnet")}</strong></div>
      <div class="field"><span>Status</span><strong>${escapeHtml(deviceStatus)}</strong></div>
    </div>

    <div class="extension-field-section">
      <h3>Feldinformationen</h3>
      <div class="field-grid extension-used-fields">
        ${usedFields.length ? usedFields.map(([key, value]) => `
          <div class="field">
            <span>${escapeHtml(extensionFieldLabel(key))}</span>
            <strong>${escapeHtml(formatExtensionFieldValue(value))}</strong>
          </div>
        `).join("") : `<div class="empty-state is-compact">Keine weiteren Feldwerte aus dem Portalbestand erkannt.</div>`}
      </div>
    </div>

    <div class="next-steps">
      <h3>Verknüpfungen</h3>
      ${relations.length ? relations.map((relation) => `
        <div class="readiness-item is-ok">
          <strong>${escapeHtml(relation.label)}</strong>
          <span>${escapeHtml(relation.detail)}</span>
        </div>
      `).join("") : `<div class="empty-state is-compact">Keine direkte Rufnummern-, Warteschlangen- oder Skillgruppen-Verknüpfung erkannt.</div>`}
      <button class="wide-button" data-view-shortcut="callflow" type="button">Callflow öffnen</button>
    </div>
  `;
}

function extensionFieldLabel(key) {
  return EXTENSION_FIELD_LABELS.get(key) || String(key || "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function formatExtensionFieldValue(value) {
  if (value === true) return "Ja";
  if (value === false) return "Nein";
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
    return extensionFieldLabel(left).localeCompare(extensionFieldLabel(right), "de");
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
          <strong>Spalten anpassen</strong>
          <span>Nur ausgewählte Felder werden angezeigt und an die Portal API gesendet.</span>
        </div>
        <button class="secondary-button" id="close-extension-batch-fields" type="button">Schließen</button>
      </div>
      <div class="batch-field-groups">
        ${groups.map((group) => `
          <fieldset>
            <legend>${escapeHtml(group)}</legend>
            ${EXTENSION_BATCH_OPTIONAL_FIELDS.filter((field) => field.group === group).map((field) => `
              <label class="batch-field-option">
                <input data-extension-batch-option="${escapeHtml(field.key)}" type="checkbox" ${state.extensionBatchSelectedFields.includes(field.key) ? "checked" : ""}>
                <span>${escapeHtml(field.label)}</span>
                <small>${field.group === "Mailbox" ? "Mailbox-Endpunkt" : "Nebenstelle"}</small>
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
  const writesEnabled = liveWritesEnabled();
  const optionalFields = selectedExtensionBatchFields();
  const tableColumns = `minmax(96px, .6fr) minmax(180px, 1fr) minmax(120px, .7fr) ${optionalFields.map(() => "minmax(150px, .85fr)").join(" ")} 42px`;
  const csvColumns = ["number", "name", "mailboxPin", ...optionalFields.map((field) => field.key)].join(",");
  target.innerHTML = `
    <div class="batch-help">
      <details>
        <summary>CSV Format</summary>
        <p>Erste Zeile als Kopf: <code>${escapeHtml(csvColumns)}</code>. Pflicht sind <code>number</code>, <code>name</code> und <code>mailboxPin</code>. Optionale Spalten entsprechen den aktivierten API-Feldern.</p>
      </details>
      <label class="batch-upload">CSV Import
        <input id="extension-batch-csv" type="file" accept=".csv,text/csv">
      </label>
      <button class="secondary-button" id="toggle-extension-batch-fields" type="button" aria-expanded="${state.extensionBatchOptionalOpen ? "true" : "false"}">Spalten anpassen</button>
    </div>
    ${renderExtensionBatchFieldPicker()}
    <div class="extension-batch-table" style="--batch-columns: ${escapeHtml(tableColumns)}">
      <div class="extension-batch-head">
        <span>Nummer</span>
        <span>Name</span>
        <span>Mailbox-PIN</span>
        ${optionalFields.map((field) => `<span>${escapeHtml(field.label)}</span>`).join("")}
        <span></span>
      </div>
      ${rows.map((row, index) => `
        <div class="extension-batch-row" data-extension-batch-row="${index}">
          <input data-extension-batch-field="extensionNumber" value="${escapeHtml(row.extensionNumber || "")}" inputmode="numeric" placeholder="201">
          <input data-extension-batch-field="displayName" value="${escapeHtml(row.displayName || "")}" placeholder="Name">
          <input data-extension-batch-field="mailboxPin" value="${escapeHtml(row.mailboxPin || "")}" inputmode="numeric" placeholder="123456">
          ${optionalFields.map((field) => renderExtensionBatchInput(row, field)).join("")}
          <button class="icon-button is-light" data-remove-extension-batch-row="${index}" type="button" aria-label="Zeile entfernen">×</button>
        </div>
      `).join("")}
    </div>
    ${plan ? `
      <div class="batch-result ${plan.ok ? "" : "is-warning"}">
        <div class="batch-result-header">
          <span class="batch-status-pill ${plan.ok ? "is-ok" : "is-warning"}">${plan.ok ? "Bereit" : "Prüfen"}</span>
          <div>
            <strong>${escapeHtml(plan.title || "Batch geprüft")}</strong>
            <span>${escapeHtml(plan.message || "")}</span>
          </div>
        </div>
        <div class="batch-summary-strip" aria-label="Batch Ergebnis">
          <div><span>Zeilen</span><strong>${escapeHtml(plan.summary?.total || 0)}</strong></div>
          <div><span>Bereit</span><strong>${escapeHtml(plan.summary?.valid || 0)}</strong></div>
          <div><span>Korrektur</span><strong>${escapeHtml(plan.summary?.invalid || 0)}</strong></div>
          <div><span>Bestand</span><strong>${escapeHtml(plan.summary?.existing || 0)}</strong></div>
        </div>
        <div class="batch-plan-list">
          ${(plan.entries || []).map((entry) => `
            <div class="batch-plan-row">
              <span class="batch-row-state ${entry.ok ? "is-ok" : "is-error"}">${entry.ok ? "OK" : "Fehler"}</span>
              <strong>${escapeHtml(entry.extensionNumber || "-")}</strong>
              <span>${escapeHtml(entry.displayName || "")}</span>
              <small>${escapeHtml(entry.ok ? "anlegen + Mailbox-PIN setzen" : (entry.errors || []).join(", "))}</small>
            </div>
          `).join("")}
        </div>
        ${plan.ok && !plan.applied ? `
          <div class="sync-apply-row">
            <button class="primary-button" id="apply-extension-batch" type="button" ${writesEnabled ? "" : "disabled"}>${state.extensionBatchLoading ? "Übernimmt..." : "Batch übernehmen"}</button>
            <span>${escapeHtml(writesEnabled ? "Legt Nebenstellen live an und setzt die Mailbox-PIN." : "Live-Schreiben ist global in Settings deaktiviert.")}</span>
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
    list.innerHTML = `<div class="empty-state">Keine Rufnummern gefunden.</div>`;
    return;
  }

  list.innerHTML = dids.map((did) => `
    <button class="did-row ${did.id === state.selectedDidId ? "is-selected" : ""}" type="button" data-did-id="${escapeHtml(did.id)}">
      <strong>${escapeHtml(did.name)}</strong>
      <span>${escapeHtml(did.value || did.destinationName || "kein Ziel erkannt")}</span>
      <small>${escapeHtml(targetTypeLabel(did.destinationType))}</small>
    </button>
  `).join("");
}

function emptyFlowStepTarget() {
  return {
    type: "PLACEHOLDER",
    title: "Neuer Schritt",
    subtitle: "Art wählen",
    targetNumber: "",
    routeNumber: "",
    tone: targetTone("PLACEHOLDER"),
    config: {},
  };
}

function renderFlowResourcePalette() {
  const target = $("#flow-resource-palette");
  if (!target) return;
  const overview = getOverview();
  const groups = [
    {
      key: "extensions",
      title: "Nebenstellen",
      type: "PHONEEXTENSION",
      tone: "green",
      items: (overview?.inventory?.extensions || []).filter((extension) => {
        const query = state.flowExtensionFilter.trim().toLowerCase();
        if (!query) return true;
        return `${extension.number || ""} ${extension.name || ""} ${extension.email || ""} ${extension.device || ""}`.toLowerCase().includes(query);
      }),
      fallback: "Keine Nebenstelle gefunden",
      searchable: true,
    },
    {
      key: "queues",
      title: "Warteschlangen",
      type: "QUEUE",
      tone: "amber",
      items: overview?.inventory?.queues || [],
      fallback: "Keine Warteschlangen",
    },
    {
      key: "ivrs",
      title: "Sprachdialoge",
      type: "IVR",
      tone: "coral",
      items: overview?.inventory?.ivrs || [],
      fallback: "Keine Sprachdialoge",
    },
    {
      key: "skills",
      title: "Skillgruppen",
      type: "SKILL",
      tone: "teal",
      items: overview?.inventory?.skills || [],
      fallback: "Keine Skillgruppen",
    },
    {
      key: "timeControls",
      title: "Zeitsteuerungen",
      type: "TIMECONTROL",
      tone: "purple",
      items: overview?.inventory?.timeControls || [],
      fallback: "Keine Zeitsteuerungen",
      limit: 12,
    },
    {
      key: "menus",
      title: "Sprachdialoge",
      type: "IVR",
      tone: "purple",
      template: true,
      items: [{ id: "new-ivr-menu", name: "Neuer Sprachdialog", extensionNumber: "", serviceNumber: "" }],
    },
  ];

  target.innerHTML = groups.map((group) => `
    <section class="flow-menu-content" data-flow-menu-content="${escapeHtml(group.key)}">
      ${group.searchable ? `
        <input class="flow-palette-search" id="flow-extension-filter" type="search" placeholder="Name oder Nummer suchen" value="${escapeHtml(state.flowExtensionFilter)}">
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
              title: "Sprachdialog",
              subtitle: "Tasten konfigurieren",
              targetNumber: "",
              routeNumber: "",
              tone: group.tone || targetTone(group.type),
              config: { portalMode: "new", announcement: "", ivrKeys: [] },
            }
            : group.type === "PHONEEXTENSION"
              ? {
                type: "PHONEEXTENSION",
                title: item.name || `Nebenstelle ${targetNumber}`,
                subtitle: `Nebenstelle ${targetNumber}`,
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
              <span>${escapeHtml(item.name || group.title)}</span>
              <small>${escapeHtml(item.detail || [targetNumber && `Nebenstelle ${targetNumber}`, routeNumber && routeNumber !== targetNumber && `Service ${routeNumber}`].filter(Boolean).join(" · ") || (group.template ? "neu anlegen" : targetTypeLabel(group.type)))}</small>
            </button>
          `;
        }).join("") : `<div class="empty-state is-compact">${escapeHtml(group.fallback || "Keine Einträge")}</div>`}
      </div>
    </section>
  `).join("");
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
  const flow = state.flow || buildDemoFlow(getOverview() || {});
  sanitizeFlowPositions(flow);
  const graph = buildVisibleFlowGraph(flow);
  const nodes = graph.nodes;
  const nodeById = Object.fromEntries(nodes.map((node) => [node.id, node]));
  const focusedEdges = focusedFlowEdgeKeys(graph, state.selectedNodeId);
  const zoom = state.flowZoom || 1;
  const worldWidth = FLOW_WORLD_WIDTH;
  const worldHeight = FLOW_WORLD_HEIGHT;
  const edgeViews = graph.edges.map((edge) => {
    const from = nodeById[edge.from];
    const to = nodeById[edge.to];
    if (!from || !to) return { path: "", insert: "" };
    const fromBox = nodeWorldBox(from);
    const toBox = nodeWorldBox(to);
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
      insert: !isVirtualEdge && distance > 130 ? `
      <button class="flow-insert ${isBranchAction ? "is-label" : "is-arrow"} ${focusClass}" type="button"
        data-insert-from="${escapeHtml(edge.from)}"
        data-insert-to="${escapeHtml(edge.to)}"
        style="left:${arrow.x}px;top:${arrow.y}px;--flow-angle:${arrowAngle}deg"
        title="Schritt an dieser Stelle einfügen"
        aria-label="Schritt zwischen ${escapeHtml(from.title)} und ${escapeHtml(to.title)} einfügen">
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
                <div class="node-action-buttons" aria-label="${escapeHtml(node.title)} Aktionen">
                  ${node.virtual ? "" : `<button class="node-action-button" type="button" data-node-edit="${escapeHtml(node.id)}" title="Bearbeiten" aria-label="${escapeHtml(node.title)} bearbeiten">✎</button>`}
                  <button class="node-action-button is-danger" type="button" data-node-delete="${escapeHtml(node.id)}" title="Löschen" aria-label="${escapeHtml(node.title)} löschen">×</button>
                </div>
              ` : ""}
              ${node.virtual ? "" : renderNodeDock(node)}
              <span class="node-type">${escapeHtml(readableNodeType(node.type))}</span>
              <span class="node-title">${escapeHtml(node.title)}</span>
              <span class="node-subtitle">${escapeHtml(flowNodeSubtitle(node))}</span>
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
  const zoomLabel = $("#zoom-label");
  if (zoomLabel) zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

function renderNodeDock(node) {
  return `
    <button class="node-dock" type="button"
      data-node-dock="${escapeHtml(node.id)}"
      title="Leitung ziehen"
      aria-label="Leitung von ${escapeHtml(node.title)} ziehen">
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

function serviceMemberDefaultPosition(serviceNode, index) {
  return safeFlowPosition(
    (Number(serviceNode.x) || 20) + 28 + (index % 2) * 24,
    (Number(serviceNode.y) || 30) - 4 + Math.floor(index / 2) * 18,
  );
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
    const members = Array.isArray(meta.memberTargets) ? meta.memberTargets : [];
    members.forEach((member, index) => {
      const memberKey = serviceMemberKey(member, index);
      const id = serviceMemberNodeId(node.id, memberKey);
      if (nodes.some((item) => item.id === id)) return;
      const savedPosition = serviceMemberLayouts(node)[memberKey];
      const position = savedPosition || serviceMemberDefaultPosition(node, index);
      nodes.push({
        id,
        type: "PHONEEXTENSION",
        title: member.name || "Nebenstelle",
        subtitle: member.number ? `Nebenstelle ${member.number}` : "Nebenstelle",
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
        label: "Mitglied",
        virtual: true,
      });
    });
  });
}

function materializeBranchNodes(flow) {
  flow.nodes ||= [];
  flow.edges ||= [];
  for (let pass = 0; pass < 8; pass += 1) {
    const before = `${flow.nodes.length}:${flow.edges.length}`;
    for (const node of [...flow.nodes]) {
      const kind = normalizeTargetType(node.type);
      if (node.isTarget) continue;
      ensureNodeConfig(node);
      if (kind === "TIMECONTROL") {
        if (node.config.portalMode === "existing" && !node.config.openTarget && !node.config.closedTarget) continue;
        ensureBranches(flow, node, [
          branchSpec("openTarget", "innerhalb", "Innerhalb", "Ziel wählen", 24, -16, node.config.openTarget),
          branchSpec("closedTarget", "außerhalb", "Außerhalb", "Ziel wählen", 24, 18, node.config.closedTarget),
        ]);
      }
      if (kind === "IVR") {
        if (node.config.portalMode === "existing" && !ivrKeyNumbers(node).length && !node.config.timeoutTarget) continue;
        const keys = ivrKeyNumbers(node);
        const keySpecs = keys.map((key, index) => {
          const field = ivrTargetField(key);
          return branchSpec(field, `Taste ${key}`, `Taste ${key}`, "Ziel wählen", 26, -22 + index * 24, node.config[field]);
        });
        ensureBranches(flow, node, [
          ...keySpecs,
          branchSpec("timeoutTarget", "Timeout", "Keine Eingabe", "Ziel wählen", 26, -22 + keys.length * 24, node.config.timeoutTarget),
        ]);
      }
      if (kind === "ANNOUNCEMENT") {
        ensureBranches(flow, node, [
          branchSpec("afterTarget", "danach", "Danach", "Auflegen oder weiterleiten", 24, 8, node.config.afterTarget),
        ]);
      }
      if (kind === "QUEUE") {
        if (node.config.timeoutSeconds || node.config.timeoutTarget) {
          ensureBranches(flow, node, [
            branchSpec("timeoutTarget", `nach ${node.config.timeoutSeconds || 120}s`, "Timeout", "Ziel wählen", 24, 20, node.config.timeoutTarget),
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
    subtitle: target.subtitle || target.number || target.targetNumber || spec.fallbackSubtitle,
    targetNumber: target.targetNumber || target.number || "",
    routeNumber: target.routeNumber || "",
    ...safeFlowPosition((Number(source.x) || 20) + spec.xOffset, (Number(source.y) || 30) + spec.yOffset),
    tone: target.tone || targetTone(type),
    missing: !spec.target,
    config: target.config ? clone(target.config) : {},
  };
  markBranchTarget(node, source, spec);
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
  return Boolean(node.missing) || normalizeTargetType(node.type) === "PLACEHOLDER" || !node.title || node.title === "Ziel wählen";
}

function applyTargetToNode(node, target) {
  if (!node || !target) return;
  const type = normalizeTargetType(target.type);
  node.type = type;
  node.title = target.title || node.title || "Ziel";
  node.subtitle = target.subtitle || target.number || target.targetNumber || node.subtitle || "";
  node.targetNumber = target.targetNumber || target.number || targetNumberFromText(node.subtitle);
  node.routeNumber = target.routeNumber || node.routeNumber || node.targetNumber || "";
  node.href = target.href || node.href || "";
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
}

function syncBranchSourceConfig(node) {
  if (!node?.branchTarget || !node.sourceId || !node.branchField) return;
  const source = (state.flow?.nodes || []).find((item) => item.id === node.sourceId);
  if (!source) return;
  ensureNodeConfig(source);
  if (isMissingFlowNode(node)) delete source.config[node.branchField];
  else source.config[node.branchField] = targetFromFlowNode(node);
}

function targetFromFlowNode(node) {
  if (!node) return null;
  const target = {
    type: normalizeTargetType(node.type),
    title: node.title || "Ziel",
    subtitle: node.subtitle || "",
    targetNumber: node.targetNumber || targetNumberFromText(node.subtitle),
    routeNumber: node.routeNumber || node.targetNumber || targetNumberFromText(node.subtitle),
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
  const position = safeFlowPosition(node.x, node.y);
  const x = position.x / 100 * FLOW_WORLD_WIDTH;
  const y = position.y / 100 * FLOW_POSITION_HEIGHT;
  return {
    x,
    y,
    centerX: x + FLOW_NODE_WIDTH / 2,
    centerY: y + FLOW_NODE_HEIGHT / 2,
    width: FLOW_NODE_WIDTH,
    height: FLOW_NODE_HEIGHT,
  };
}

function nodeEdgePoint(sourceBox, targetBox) {
  const dx = targetBox.centerX - sourceBox.centerX;
  const dy = targetBox.centerY - sourceBox.centerY;
  if (!dx && !dy) return { x: sourceBox.centerX, y: sourceBox.centerY + FLOW_NODE_HEIGHT / 2 };

  const halfWidth = FLOW_NODE_WIDTH / 2;
  const halfHeight = FLOW_NODE_HEIGHT / 2;
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
  if (kind === "TIMECONTROL") return node.config?.hours || node.subtitle || "Zeitfenster festlegen";
  if (kind === "IVR") return node.config?.announcement ? `Ansage: ${node.config.announcement}` : node.subtitle || "Tasten konfigurieren";
  if (kind === "ANNOUNCEMENT") return node.config?.announcement || node.subtitle || "Ansage wählen";
  if (kind === "HANGUP") return "Anruf beenden";
  return node.subtitle || "";
}

function flowNodeNumberMeta(node) {
  const kind = normalizeTargetType(node?.type);
  if (!node || ["DID", "HANGUP", "PLACEHOLDER", "PHONEEXTENSION", "PHONE"].includes(kind)) return "";
  const extensionNumber = String(node.targetNumber || targetNumberFromText(node.subtitle) || "").trim();
  const routeNumber = String(node.routeNumber || "").trim();
  const parts = [];
  if (extensionNumber) parts.push(`Nebenstelle ${extensionNumber}`);
  if (routeNumber && routeNumber !== extensionNumber && !["PHONEEXTENSION", "PHONE"].includes(kind)) {
    parts.push(`Service ${routeNumber}`);
  }
  return parts.join(" · ");
}

function flowNodeDetail(node) {
  const kind = normalizeTargetType(node.type);
  if (kind === "DID") return node.detail || "";
  if (kind === "TIMECONTROL") {
    return "innerhalb / außerhalb";
  }
  if (kind === "IVR") {
    return ivrKeyNumbers(node).map((key) => {
      const keyNode = branchTargetNode(node, ivrTargetField(key));
      return `${key} ${isMissingFlowNode(keyNode) ? "Ziel fehlt" : keyNode.title}`;
    }).join(" / ");
  }
  if (kind === "ANNOUNCEMENT") {
    const afterNode = branchTargetNode(node, "afterTarget");
    return isMissingFlowNode(afterNode) ? "danach auflegen" : afterNode.title;
  }
  if (["QUEUE", "GROUP", "SKILL"].includes(kind)) {
    const meta = nodeServiceMeta(node);
    const details = [];
    if (Number.isFinite(Number(meta.memberCount))) {
      const count = Number(meta.memberCount);
      details.push(`${count} Mitglied${count === 1 ? "" : "er"}`);
    }
    if (Array.isArray(meta.memberNames) && meta.memberNames.length) {
      details.push(`gekoppelt: ${meta.memberNames.join(" / ")}`);
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
  return detail ? `<span class="node-detail">${escapeHtml(detail)}</span>` : "";
}

function renderServiceFlowNodeDetail(node) {
  const meta = nodeServiceMeta(node);
  const count = Number.isFinite(Number(meta.memberCount)) ? Number(meta.memberCount) : 0;
  const members = Array.isArray(meta.memberTargets) ? meta.memberTargets : [];
  const names = Array.isArray(meta.memberNames) ? meta.memberNames : [];
  const expanded = state.expandedServiceNodeIds.includes(node.id);
  const summary = count
    ? `${count} Mitglied${count === 1 ? "" : "er"}`
    : "Keine Mitglieder";
  const preview = members.length
    ? members
    : names.map((name) => ({ name, number: "" }));
  return `
    <div class="node-detail service-node-detail">
      <span class="node-detail-summary">${escapeHtml(summary)}</span>
      ${preview.length ? `
        <button class="node-detail-toggle" type="button" data-node-members-toggle="${escapeHtml(node.id)}">
          ${expanded ? "Ziele ausblenden" : "Ziele zeigen"}
        </button>
      ` : ""}
    </div>
  `;
}

function readableNodeType(type) {
  const labels = {
    DID: "Rufnummer",
    Trunk: "Leitung",
    PHONEEXTENSION: "Nebenstelle",
    PHONE: "Nebenstelle",
    QUEUE: "Warteschlange",
    GROUP: "Skillgruppe",
    SKILL: "Skillgruppe",
    FRONTDESK: "Frontdesk",
    TIMECONTROL: "Zeitsteuerung",
    Zeitsteuerung: "Zeit",
    IVR: "Sprachdialog",
    ANNOUNCEMENT: "Ansage",
    HANGUP: "Auflegen",
    PLACEHOLDER: "Pfad",
    Gruppe: "Team",
    Nebenstelle: "Nebenstelle",
    Fallback: "Fallback",
  };
  return labels[type] || type || "Schritt";
}

function nodeTypeOptions(node) {
  const kind = normalizeTargetType(node?.type);
  if (kind === "PLACEHOLDER" || node?.missing) return ["PLACEHOLDER", "QUEUE", "IVR", "SKILL", "TIMECONTROL"];
  const options = ["PLACEHOLDER", "PHONEEXTENSION", "QUEUE", "SKILL", "FRONTDESK", "IVR", "TIMECONTROL", "ANNOUNCEMENT", "HANGUP"];
  return options.includes(kind) ? options : [kind, ...options];
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
      <h3>${targetEditMode ? "Ziel ändern" : "Schritt im Callflow"}</h3>
      <button class="helper-close-button" id="close-flow-helper" type="button" aria-label="Eigenschaften schließen">×</button>
    </div>
    <p class="helper-copy">${targetEditMode ? "Wähle aus, wohin diese Rufnummer künftig führen soll. Es bleibt ein Entwurf." : "Konfiguriere diesen Schritt. Pflichtfelder werden unten geprüft."}</p>
    ${numberMeta ? `<div class="helper-number-meta">${escapeHtml(numberMeta)}</div>` : ""}
    <div class="before-after">
      <span>Aktuell</span>
      <strong>${escapeHtml(did?.name || "-")} → ${escapeHtml(did?.value || "kein Ziel")}</strong>
      <span>Entwurf</span>
      <strong>${escapeHtml(did?.name || "-")} → ${escapeHtml(currentDraftTarget())}</strong>
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
      <label>${kind === "IVR" ? "Name im Portal" : "Name"}
        <input data-node-field="title" value="${escapeHtml(node.title)}" ${node.locked || targetNameIsDerived ? "disabled" : ""}>
      </label>
      ${targetNameIsDerived ? `<p class="field-note">Der Name kommt aus dem gewählten Portal-Ziel. Der Callflow ändert hier nur die Route.</p>` : ""}
      ${renderNodeConfiguration(node)}
    </form>
    ${renderConnectionBuilder(node)}
    <div class="helper-actions">
      <button class="secondary-button" id="delete-flow-node" type="button" ${node.locked ? "disabled" : ""}>Schritt entfernen</button>
    </div>
    <div class="validation-box">
      <strong>Status</strong>
      <span>${escapeHtml(validation.checks.join(" · "))}</span>
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
          <option value="">Ziel im Callflow wählen</option>
          ${targets.map((target) => `
            <option value="${escapeHtml(target.id)}">${escapeHtml(connectionTargetLabel(target))}</option>
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
  return [
    readableNodeType(node.type),
    node.title,
    flowNodeNumberMeta(node) || node.subtitle,
  ].filter(Boolean).join(" · ");
}

function renderBulkFlowHelper(nodes) {
  const editableNodes = nodes.filter((node) => !node.locked);
  const labels = editableNodes.slice(0, 5).map((node) => node.title).join(" · ");
  return `
    <div class="helper-header">
      <h3>${nodes.length} Kacheln ausgewählt</h3>
      <button class="helper-close-button" id="close-flow-helper" type="button" aria-label="Auswahl schließen">×</button>
    </div>
    <p class="helper-copy">Mehrfachauswahl per Shift + Ziehen. Gelockte Startknoten bleiben geschützt.</p>
    <div class="before-after">
      <span>Auswahl</span>
      <strong>${escapeHtml(labels || "Keine änderbaren Kacheln")}${editableNodes.length > 5 ? " …" : ""}</strong>
      <span>Änderbar</span>
      <strong>${editableNodes.length} von ${nodes.length}</strong>
    </div>
    <form class="action-form" id="bulk-node-form">
      <label>Alle änderbaren Kacheln auf Ziel setzen
        ${renderTargetSelect("bulk-target-select", "", "", true)}
      </label>
    </form>
    <div class="helper-actions">
      <button class="secondary-button" id="delete-selected-nodes" type="button" ${editableNodes.length ? "" : "disabled"}>Auswahl löschen</button>
    </div>
  `;
}

function renderTimeControlBranchHelper(node, did, validation) {
  const field = state.selectedBranchField;
  const isClosed = field === "closedTarget";
  const label = isClosed ? "Außerhalb der Zeit" : "Innerhalb der Zeit";
  return `
    <div class="helper-header">
      <h3>Pfad: ${escapeHtml(label)}</h3>
      <button class="helper-close-button" id="close-flow-helper" type="button" aria-label="Eigenschaften schließen">×</button>
    </div>
    <p class="helper-copy">Dieser Ausgang der Zeitsteuerung kann wieder auf eine Warteschlange, Ansage, Sprachdialog, Nebenstelle oder später auf weitere Schritte führen.</p>
    <div class="before-after">
      <span>Zeitsteuerung</span>
      <strong>${escapeHtml(node.title)} · ${escapeHtml(node.config?.hours || "Zeitfenster fehlt")}</strong>
      <span>Pfad</span>
      <strong>${escapeHtml(label)} → ${escapeHtml(node.config?.[field]?.title || "Ziel wählen")}</strong>
    </div>
    <form class="action-form" id="node-form">
      <label${requiredFieldClass(isMissingFlowNode(branchTargetNode(node, field)) && !(isClosed && node.config?.announcement))}>Ziel für diesen Pfad
        ${renderTargetSelect("", field, targetConfigValue(node.config?.[field]), true)}
      </label>
      ${isClosed ? `
        <label>Optionale Ansage vor dem Ziel
          ${renderAnnouncementSelect(node.config?.announcement || "")}
        </label>
      ` : ""}
    </form>
    <div class="helper-actions">
      <button class="secondary-button" data-branch-back="${escapeHtml(node.id)}" type="button">Zeitsteuerung bearbeiten</button>
    </div>
    <div class="validation-box">
      <strong>Status</strong>
      <span>${escapeHtml(validation.checks.join(" · "))}</span>
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

  if (kind === "PLACEHOLDER") issues.push("Schrittart fehlt");

  if (kind === "TIMECONTROL") {
    if (!node.config.portalMode) {
      issues.push("Neu oder Auswahl wählen");
    } else if (node.config.portalMode === "existing") {
      if (!(node.routeNumber || node.targetNumber)) issues.push("Vorhandene Zeitsteuerung fehlt");
    } else {
      if (!node.config.hours) issues.push("Zeitfenster fehlt");
      if (isMissingFlowNode(branchTargetNode(node, "openTarget"))) issues.push("Ziel innerhalb fehlt");
      if (isMissingFlowNode(branchTargetNode(node, "closedTarget")) && !node.config.announcement) {
        issues.push("Ziel außerhalb fehlt");
      }
    }
  }

  if (kind === "IVR") {
    if (!node.config.portalMode) {
      issues.push("Neu oder Auswahl wählen");
    } else if (node.config.portalMode === "existing") {
      if (!(node.routeNumber || node.targetNumber)) issues.push("Vorhandener Sprachdialog fehlt");
    } else {
      if (!node.config.announcement) issues.push("Ansage fehlt");
      if (!ivrKeyNumbers(node).some((key) => !isMissingFlowNode(branchTargetNode(node, ivrTargetField(key))))) {
        issues.push("Tasten-Ziel fehlt");
      }
      if (isMissingFlowNode(branchTargetNode(node, "timeoutTarget"))) issues.push("Timeout-Ziel fehlt");
    }
  }

  if (kind === "ANNOUNCEMENT" && !node.config.announcement) issues.push("Ansage fehlt");

  if (kind === "QUEUE" && node.config.timeoutSeconds && isMissingFlowNode(branchTargetNode(node, "timeoutTarget"))) {
    issues.push("Timeout-Ziel fehlt");
  }
  if (["QUEUE", "GROUP", "SKILL"].includes(kind)) {
    if (!node.config.portalMode) issues.push("Neu oder Auswahl wählen");
    if (node.config.portalMode === "existing" && !(node.routeNumber || node.targetNumber)) {
      issues.push(`Vorhandene ${readableNodeType(kind)} fehlt`);
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
        <input data-node-config-field="timeoutSeconds" type="number" min="0" step="5" value="${escapeHtml(node.config?.timeoutSeconds || "")}" placeholder="z. B. 120">
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
        <input data-node-config-field="hours" value="${escapeHtml(node.config?.hours || "Mo-Fr 08:00-17:00")}">
      </label>
      <div class="branch-summary">
        <strong>Ausgänge</strong>
        <span>Innerhalb</span>
        <span>Außerhalb</span>
      </div>
    `;
  }

  if (kind === "IVR") {
    const keys = ivrKeyNumbers(node);
    const keyFields = keys.map((key) => `
      <label${requiredFieldClass(isMissingFlowNode(branchTargetNode(node, ivrTargetField(key))))}>Taste ${escapeHtml(key)}
        ${renderTargetSelect("", ivrTargetField(key), targetConfigValue(node.config?.[ivrTargetField(key)]), true)}
      </label>
    `).join("");
    const nextKey = nextIvrKey(node);
    return `
      <label${requiredFieldClass(!node.config?.announcement)}>Ansage vor der Auswahl
        ${renderAnnouncementSelect(node.config?.announcement || "")}
      </label>
      ${keyFields}
      <button class="secondary-button" data-add-ivr-key="${escapeHtml(node.id)}" type="button" ${nextKey ? "" : "disabled"}>Taste hinzufügen</button>
      <label${requiredFieldClass(isMissingFlowNode(branchTargetNode(node, "timeoutTarget")))}>Keine Eingabe / Timeout
        ${renderTargetSelect("", "timeoutTarget", targetConfigValue(node.config?.timeoutTarget), true)}
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
        <input value="Nach diesem Schritt wird aufgelegt." disabled>
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
  const label = ["GROUP", "SKILL"].includes(kind) ? "Skillgruppe" : readableNodeType(kind);
  return `
    <label${requiredFieldClass(!mode)}>Quelle
      <select data-node-config-field="portalMode">
        <option value="" ${!mode ? "selected" : ""}>Neu oder Auswahl wählen</option>
        <option value="new" ${mode === "new" ? "selected" : ""}>Neue ${escapeHtml(label)} anlegen</option>
        <option value="existing" ${mode === "existing" ? "selected" : ""}>Vorhandene ${escapeHtml(label)} auswählen</option>
      </select>
    </label>
  `;
}

function renderResourceTargetSelect(kind, selectedValue = "") {
  const options = targetOptions().filter((target) => normalizeTargetType(target.kind) === kind);
  return `
    <select data-node-resource-target="${escapeHtml(kind)}">
      <option value="">Vorhandenes Portal-Ziel wählen</option>
      ${options.map((target) => `
        <option value="${escapeHtml(target.value)}" ${targetOptionSelected(target.value, selectedValue) ? "selected" : ""}>${escapeHtml(target.label)}</option>
      `).join("")}
    </select>
  `;
}

function renderResourceNodeConfiguration(node, kind) {
  const mode = resourceMode(node);
  const sourceChoice = renderResourceSourceChoice(node, kind);
  if (!mode) {
    return `${sourceChoice}<p class="field-note">Lege fest, ob dieser Schritt ein neues Portal-Objekt erzeugt oder auf ein bestehendes Ziel verweist.</p>`;
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
        <input data-node-config-field="timeoutSeconds" type="number" min="0" step="5" value="${escapeHtml(node.config?.timeoutSeconds || "")}" placeholder="z. B. 120">
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
        <input data-node-config-field="hours" value="${escapeHtml(node.config?.hours || "")}" placeholder="z. B. Mo-Fr 08:00-17:00">
      </label>
      <label${requiredFieldClass(isMissingFlowNode(branchTargetNode(node, "openTarget")))}>Ziel innerhalb
        ${renderTargetSelect("", "openTarget", targetConfigValue(node.config?.openTarget), true)}
      </label>
      <label${requiredFieldClass(isMissingFlowNode(branchTargetNode(node, "closedTarget")) && !node.config?.announcement)}>Ziel außerhalb
        ${renderTargetSelect("", "closedTarget", targetConfigValue(node.config?.closedTarget), true)}
      </label>
      <div class="branch-summary">
        <strong>Ausgänge</strong>
        <span>Innerhalb</span>
        <span>Außerhalb</span>
      </div>
    `;
  }
  if (kind === "IVR") {
    const keys = ivrKeyNumbers(node);
    const keyFields = keys.map((key) => `
      <label${requiredFieldClass(isMissingFlowNode(branchTargetNode(node, ivrTargetField(key))))}>Taste ${escapeHtml(key)}
        ${renderTargetSelect("", ivrTargetField(key), targetConfigValue(node.config?.[ivrTargetField(key)]), true)}
      </label>
    `).join("");
    const nextKey = nextIvrKey(node);
    return `
      ${sourceChoice}
      <label${requiredFieldClass(!node.config?.announcement)}>Ansage vor der Auswahl
        ${renderAnnouncementSelect(node.config?.announcement || "")}
      </label>
      ${keyFields}
      <button class="secondary-button" data-add-ivr-key="${escapeHtml(node.id)}" type="button" ${nextKey ? "" : "disabled"}>Taste hinzufügen</button>
      <label${requiredFieldClass(isMissingFlowNode(branchTargetNode(node, "timeoutTarget")))}>Keine Eingabe / Timeout
        ${renderTargetSelect("", "timeoutTarget", targetConfigValue(node.config?.timeoutTarget), true)}
      </label>
    `;
  }
  return sourceChoice;
}

function renderTargetSelect(id, configField, selectedValue = "", allowHangup = false) {
  const idAttribute = id ? ` id="${escapeHtml(id)}"` : "";
  const dataAttribute = configField ? ` data-node-target-config="${escapeHtml(configField)}"` : "";
  const options = targetOptions();
  const hangupOption = allowHangup
    ? `<option value="${escapeHtml(JSON.stringify({ type: "HANGUP", title: "Auflegen", subtitle: "Anruf beenden", tone: "muted" }))}" ${selectedValue.includes('"HANGUP"') ? "selected" : ""}>- - (Auflegen | Anruf beenden)</option>`
    : "";
  return `
    <span class="select-search-stack">
      <input class="select-filter-input" type="search" placeholder="Ziel suchen..." aria-label="Ziel suchen">
      <select${idAttribute}${dataAttribute}>
        <option value="">Ziel wählen</option>
        ${hangupOption}
        ${options.map((target) => `
          <option value="${escapeHtml(target.value)}" ${targetOptionSelected(target.value, selectedValue) ? "selected" : ""}>${escapeHtml(target.label)}</option>
        `).join("")}
      </select>
    </span>
  `;
}

function targetOptionSelected(optionValue, selectedValue) {
  if (!selectedValue) return false;
  if (optionValue === selectedValue) return true;
  try {
    return targetCompareKey(JSON.parse(optionValue)) === targetCompareKey(JSON.parse(selectedValue));
  } catch {
    return false;
  }
}

function renderAnnouncementSelect(selectedValue = "") {
  const announcements = getOverview()?.inventory?.announcements || [];
  if (!announcements.length) {
    return `<input data-node-config-field="announcement" value="${escapeHtml(selectedValue)}" placeholder="Ansage im Portal anlegen oder Namen eingeben">`;
  }
  return `
    <span class="select-search-stack">
      <input class="select-filter-input" type="search" placeholder="Ansage suchen..." aria-label="Ansage suchen">
      <select data-node-config-field="announcement">
        <option value="">Ansage wählen</option>
        ${announcements.map((announcement) => {
          const value = announcement.name || announcement.value || announcement.id;
          return `<option value="${escapeHtml(value)}" ${value === selectedValue ? "selected" : ""}>${escapeHtml(value)}</option>`;
        }).join("")}
      </select>
    </span>
  `;
}

function currentDraftTarget() {
  const flowStep = (state.flow?.nodes || []).find((item) => {
    const kind = normalizeTargetType(item.type);
    return !item.locked && !item.isTarget && !item.branchTarget && ["TIMECONTROL", "IVR", "ANNOUNCEMENT", "QUEUE", "HANGUP"].includes(kind);
  });
  if (flowStep) {
    ensureNodeConfig(flowStep);
    const kind = normalizeTargetType(flowStep.type);
    if (kind === "TIMECONTROL") {
      if (flowStep.config?.portalMode === "existing") return `${flowStep.title}: vorhandene Zeitsteuerung`;
      const openNode = branchTargetNode(flowStep, "openTarget");
      const closedNode = branchTargetNode(flowStep, "closedTarget");
      const open = isMissingFlowNode(openNode) ? "Ziel fehlt" : openNode.title;
      const closed = isMissingFlowNode(closedNode)
        ? (flowStep.config.announcement ? `${flowStep.config.announcement} + Auflegen` : "Ziel fehlt")
        : closedNode.title;
      return `${flowStep.title}: innerhalb ${open} / außerhalb ${closed}`;
    }
    if (kind === "IVR") {
      if (flowStep.config?.portalMode === "existing") return `${flowStep.title}: vorhandener Sprachdialog`;
      const timeoutNode = branchTargetNode(flowStep, "timeoutTarget");
      const keys = ivrKeyNumbers(flowStep)
        .map((key) => {
          const keyNode = branchTargetNode(flowStep, ivrTargetField(key));
          return `${key} ${isMissingFlowNode(keyNode) ? "Ziel fehlt" : keyNode.title}`;
        })
        .join(" / ");
      const timeout = isMissingFlowNode(timeoutNode) ? "Timeout fehlt" : timeoutNode.title;
      return `${flowStep.title}: ${keys} / Timeout ${timeout}`;
    }
    if (kind === "ANNOUNCEMENT") {
      const afterNode = branchTargetNode(flowStep, "afterTarget");
      const after = isMissingFlowNode(afterNode) ? "Auflegen" : afterNode.title;
      return `${flowStep.title}: ${flowStep.config.announcement || "Ansage fehlt"} → ${after}`;
    }
    if (["QUEUE", "GROUP", "SKILL"].includes(kind) && flowStep.config?.portalMode === "new") {
      return `${flowStep.title}: neu anlegen`;
    }
    if (kind === "QUEUE" && flowStep.config.timeoutSeconds) {
      const timeoutNode = branchTargetNode(flowStep, "timeoutTarget");
      const timeout = isMissingFlowNode(timeoutNode) ? "Timeout fehlt" : timeoutNode.title;
      return `${flowStep.title}: Timeout ${flowStep.config.timeoutSeconds}s → ${timeout}`;
    }
    if (kind === "HANGUP") return `${flowStep.title}: Auflegen`;
  }
  const target = (state.flow?.nodes || []).find((item) => item.isTarget) || selectedNode();
  if (!target) return "kein Ziel";
  return [target.title, target.subtitle].filter(Boolean).join(" · ");
}

function targetConfigValue(target = null) {
  if (!target) return "";
  const value = {
    type: target.type,
    title: target.title,
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
  const compare = targetCompareKey({
    type: node.type,
    number: node.targetNumber,
    targetNumber: node.targetNumber,
    routeNumber: node.routeNumber,
    title: node.title,
    href: node.href,
  });
  return targetOptions().find((option) => {
    try {
      return targetCompareKey(JSON.parse(option.value)) === compare;
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
  if (kind === "TIMECONTROL" && node.config.portalMode !== "new") {
    node.config.hours ||= "Mo-Fr 08:00-17:00";
  }
  if (kind === "IVR") {
    node.config.announcement ||= "";
    node.config.ivrKeys ||= ivrKeyNumbers(node);
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
    value: JSON.stringify({
      type: "QUEUE",
      title: queue.name,
      subtitle: (queue.extensionNumber || queue.value) ? `Warteschlange ${queue.extensionNumber || queue.value}` : "Warteschlange",
      targetNumber: queue.extensionNumber || queue.value || "",
      routeNumber: queue.serviceNumber || queue.id || queue.value || "",
      tone: targetTone("QUEUE"),
      ...serviceMetaFor("queue", queue),
    }),
  }));
  const skills = (overview?.inventory?.skills || []).map((skill) => ({
    label: targetOptionLabel(skill.extensionNumber || skill.value, "SKILL", skill.name),
    kind: "SKILL",
    value: JSON.stringify({
      type: "SKILL",
      title: skill.name,
      subtitle: (skill.extensionNumber || skill.value) ? `Skillgruppe ${skill.extensionNumber || skill.value}` : "Skillgruppe",
      targetNumber: skill.extensionNumber || skill.value || "",
      routeNumber: skill.serviceNumber || skill.id || skill.value || "",
      tone: targetTone("SKILL"),
      ...serviceMetaFor("skill", skill),
    }),
  }));
  const ivrs = (overview?.inventory?.ivrs || []).map((ivr) => ({
    label: targetOptionLabel(ivr.value, "IVR", ivr.name),
    kind: "IVR",
    value: JSON.stringify(flowTargetFromApiTarget({
      type: "IVR",
      title: ivr.name,
      subtitle: ivr.value ? `Sprachdialog ${ivr.value}` : "Sprachdialog",
      targetNumber: ivr.value || "",
      routeNumber: ivr.serviceNumber || ivr.id || ivr.value || "",
      tone: targetTone("IVR"),
    })),
  }));
  const timeControls = (overview?.inventory?.timeControls || []).map((timeControl) => ({
    label: targetOptionLabel(timeControl.value, "TIMECONTROL", timeControl.name),
    kind: "TIMECONTROL",
    value: JSON.stringify({
      type: "TIMECONTROL",
      title: timeControl.name,
      subtitle: timeControl.value ? `Zeitsteuerung ${timeControl.value}` : "Zeitsteuerung",
      targetNumber: timeControl.value || "",
      routeNumber: timeControl.value || timeControl.id || "",
      tone: targetTone("TIMECONTROL"),
    }),
  }));
  const voicemails = [
    ...(overview?.inventory?.voicemails || []).map((voicemail) => ({
      label: targetOptionLabel(voicemail.extensionNumber || voicemail.value, "VOICEMAIL", voicemail.name),
      kind: "VOICEMAIL",
      value: JSON.stringify({
        type: "VOICEMAIL",
        title: voicemail.name,
        subtitle: (voicemail.extensionNumber || voicemail.value) ? `Anrufbeantworter ${voicemail.extensionNumber || voicemail.value}` : "Anrufbeantworter",
        targetNumber: voicemail.extensionNumber || voicemail.value || "",
        routeNumber: voicemail.serviceNumber || voicemail.id || voicemail.value || "",
        href: voicemail.href || "",
        tone: targetTone("VOICEMAIL"),
      }),
    })),
    ...(overview?.inventory?.extensions || [])
      .filter((extension) => extension.voicemailHref || extension.voicemailNumber)
      .map((extension) => ({
        label: targetOptionLabel(extension.number, "VOICEMAIL", `${extension.name} AB`),
        kind: "VOICEMAIL",
        value: JSON.stringify({
          type: "VOICEMAIL",
          title: `${extension.name} AB`,
          subtitle: `Anrufbeantworter ${extension.number}`,
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
    .map((did) => ({
      label: targetOptionLabel(did.destinationExtension, did.destinationType, did.value),
      kind: String(did.destinationType || "").toUpperCase(),
      value: JSON.stringify({
        type: did.destinationType || "PHONEEXTENSION",
        title: did.value,
        subtitle: did.destinationExtension ? `${targetTypeLabel(did.destinationType)} ${did.destinationExtension}` : targetTypeLabel(did.destinationType),
        targetNumber: did.destinationExtension || "",
        routeNumber: did.destinationServiceNumber || did.destinationExtension || "",
        tone: targetTone(did.destinationType),
        ...serviceMetaForTarget(did.destinationType, did.destinationServiceNumber, did.destinationExtension, did.destinationName || did.value),
      }),
    }));
  const extensions = (overview?.inventory?.extensions || []).map((extension) => ({
    label: targetOptionLabel(extension.number, "PHONEEXTENSION", extension.name),
    kind: "PHONEEXTENSION",
    value: JSON.stringify({
      type: "PHONEEXTENSION",
      title: extension.name,
      subtitle: `Nebenstelle ${extension.number}`,
      targetNumber: extension.number,
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
    label: "Auflegen - (Anruf beenden)",
    kind: "HANGUP",
    value: JSON.stringify({ type: "HANGUP", title: "Auflegen", routeNumber: "HANGUP", number: "HANGUP" }),
  };
  const newDialog = {
    label: "Neues Nachtziel erstellen - (Ansage + danach)",
    kind: "NEW_NIGHT_TARGET",
    value: JSON.stringify({ type: "NEW_NIGHT_TARGET", title: "Neues Nachtziel erstellen", routeNumber: "", number: "" }),
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
  const preferred = choices.find(({ target: item }) => ["IVR", "TIMECONTROL"].includes(normalizeTargetType(item.type)))
    || choices.find(({ target: item }) => normalizeTargetType(item.type) === "QUEUE")
    || choices[0];
  if (!choices.some(({ option }) => option.value === state.profileTargetValue)) {
    state.profileTargetValue = preferred?.option?.value || "";
  }
  return state.profileTargetValue;
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
  const displayName = state.daynightAnnouncementDisplayName || `Nachtansage ${selectedAnnouncement || "Ansage"}`;
  const announcementPlanReady = Boolean(state.daynightGatewayPreview?.type === "daynight-announcement-target" && state.daynightGatewayPreview?.ok);
  const canPlanAnnouncementTarget = Boolean(displayName.trim() && announcements.length && announcementSource === "existing" && !state.daynightAnnouncementLoading);
  const selectedTitle = selected ? displayTargetName(selected.type, selected.title) || targetTypeLabel(selected.type) : "kein Ziel gewählt";
  return `
    <div class="daynight-target-card ${createDialog ? "is-new-target" : ""}">
      <div>
        <span>Nachtschaltung</span>
        <strong>${escapeHtml(selectedTitle)}</strong>
        <small>${escapeHtml(createDialog ? "Erstelle zuerst ein Ziel. Danach kann der Nachtmodus geplant und aktiviert werden." : "Dieses vorhandene Ziel wird für den Nachtmodus verwendet.")}</small>
      </div>
      <label class="profile-target-control">Nachtziel
        <span class="select-search-stack">
          <input class="select-filter-input" type="search" placeholder="Ziel suchen..." aria-label="Nachtziel suchen">
          <select id="daynight-gateway-target-select">
            ${choices.map(({ option }) => `
              <option value="${escapeHtml(option.value)}" ${option.value === state.profileTargetValue ? "selected" : ""}>${escapeHtml(option.label)}</option>
            `).join("")}
          </select>
        </span>
      </label>
    </div>
    ${createDialog ? `
      <div class="daynight-announcement-card">
        <div>
          <span>Neues Nachtziel</span>
          <strong>Neuen Sprachdialog anlegen</strong>
          <small>Die vorhandene Ansage wird nur eingebunden und nicht verändert. Der Name gilt für den neuen Sprachdialog.</small>
        </div>
        <label class="profile-target-control">Name des neuen Sprachdialogs
          <input id="daynight-announcement-display-name" value="${escapeHtml(displayName)}" placeholder="z. B. Nachtansage Zentrale">
        </label>
        <div class="daynight-mode-toggle" role="group" aria-label="Ansage-Quelle">
          <label>
            <input name="daynight-announcement-source" type="radio" value="existing" ${announcementSource === "existing" ? "checked" : ""}>
            <span>Vorhandene Ansage</span>
          </label>
          <label>
            <input name="daynight-announcement-source" type="radio" value="upload" ${announcementSource === "upload" ? "checked" : ""}>
            <span>MP3/WAV hochladen</span>
          </label>
        </div>
        ${announcementSource === "existing" ? `
          <label class="profile-target-control">Ansage
            <span class="select-search-stack">
              <input class="select-filter-input" type="search" placeholder="Ansage suchen..." aria-label="Ansage suchen">
              <select id="daynight-announcement-select" ${announcements.length ? "" : "disabled"}>
                ${announcements.length ? announcements.map((announcement) => {
                  const value = announcement.name || announcement.value || announcement.id;
                  return `<option value="${escapeHtml(value)}" ${value === selectedAnnouncement ? "selected" : ""}>${escapeHtml(value)}</option>`;
                }).join("") : `<option value="">Keine Ansage gefunden</option>`}
              </select>
            </span>
          </label>
        ` : `
          <div class="announcement-upload-placeholder" aria-disabled="true">
            <span>MP3/WAV Datei</span>
            <div class="upload-control is-disabled">
              <strong>Upload vorbereitet</strong>
              <small>Wird nach dem Audiotest aktiviert</small>
              <input id="daynight-announcement-upload" type="file" accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav" disabled tabindex="-1" aria-hidden="true">
            </div>
            <small>Bis dahin bitte eine vorhandene Ansage verwenden.</small>
          </div>
        `}
        <label class="profile-target-control">Danach
          <span class="select-search-stack">
            <input class="select-filter-input" type="search" placeholder="Ziel suchen..." aria-label="Ansage-Danach-Ziel suchen">
            <select id="daynight-announcement-after-select">
              ${daynightTargetOptions({ includeCreateOption: false }).map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === afterValue ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
            </select>
          </span>
        </label>
        <div class="daynight-announcement-actions">
          <button class="secondary-button" id="plan-daynight-announcement-target" type="button" ${canPlanAnnouncementTarget ? "" : "disabled"}>${state.daynightAnnouncementLoading ? "Prüft..." : "Neues Ziel prüfen"}</button>
          <button class="primary-button" id="apply-daynight-announcement-target" type="button" ${state.daynightAnnouncementLoading || !announcementPlanReady || !liveWritesEnabled() ? "disabled" : ""}>Neues Nachtziel anlegen</button>
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
  const href = target?.href || "";
  if (href) return `${type}:href:${String(href).toLowerCase()}`;
  const number = target?.routeNumber || target?.number || target?.targetNumber || "";
  return `${type}:${String(number).toLowerCase()}`;
}

function filterSearchableSelect(input) {
  const stack = input.closest(".select-search-stack");
  const select = stack?.querySelector("select");
  if (!select) return;
  const query = input.value.trim().toLocaleLowerCase("de-DE");
  let firstMatch = null;
  Array.from(select.options).forEach((option) => {
    const keep = !query || !option.value || option.textContent.toLocaleLowerCase("de-DE").includes(query);
    option.hidden = !keep;
    option.disabled = Boolean(query && option.value && !keep);
    if (query && keep && option.value && !firstMatch) {
      firstMatch = option;
    }
  });
  if (query && firstMatch && select.value !== firstMatch.value) {
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
  if (!profile?.createdAt) return "nicht gesichert";
  return formatTime(profile.createdAt);
}

function validateFlow() {
  return validateFlowDetails().checks;
}

function validateFlowDetails() {
  const did = selectedDid();
  if (state.flow) {
    pruneDisconnectedFlowNodes(state.flow);
    materializeBranchNodes(state.flow);
  }
  const nodes = state.flow?.nodes || [];
  const complex = flowHasComplexNodes();
  const firstComplexStep = nodes.find((item) => {
    if (item.locked || item.branchTarget) return false;
    const kind = normalizeTargetType(item.type);
    return ["TIMECONTROL", "IVR", "ANNOUNCEMENT", "QUEUE", "HANGUP"].includes(kind);
  });
  const target = nodes.find((item) => item.isTarget) || firstComplexStep || selectedNode();
  const checks = [];
  const problems = [];
  if (did) checks.push("Rufnummer gewählt");
  else problems.push("Rufnummer fehlt");

  if (complex) {
    if (firstComplexStep?.title) checks.push("Start-Schritt gesetzt");
    else problems.push("Start-Schritt fehlt");
  } else if (target?.title) {
    checks.push("Ziel gesetzt");
  } else {
    problems.push("Ziel fehlt");
  }

  for (const node of nodes) {
    if (node.locked) continue;
    ensureNodeConfig(node);
    const kind = normalizeTargetType(node.type);
    if (kind === "TIMECONTROL") {
      if (!node.config.portalMode) {
        problems.push("Zeitsteuerung braucht Neu oder Auswahl");
      } else if (node.config.portalMode === "existing") {
        if (node.routeNumber || node.targetNumber) checks.push("Vorhandene Zeitsteuerung gewählt");
        else problems.push("Vorhandene Zeitsteuerung fehlt");
      } else {
        if (node.config.hours) checks.push("Zeitsteuerung hat Zeitfenster");
        else problems.push("Zeitsteuerung braucht ein Zeitfenster");
        if (!isMissingFlowNode(branchTargetNode(node, "openTarget"))) checks.push("Zeitsteuerung: Ziel innerhalb");
        else problems.push("Zeitsteuerung braucht ein Ziel innerhalb der Zeiten");
        if (!isMissingFlowNode(branchTargetNode(node, "closedTarget")) || node.config.announcement) checks.push("Zeitsteuerung: Ziel außerhalb");
        else problems.push("Zeitsteuerung braucht ein Ziel oder eine Ansage außerhalb der Zeiten");
      }
    }
    if (kind === "IVR") {
      if (!node.config.portalMode) {
        problems.push("Sprachdialog braucht Neu oder Auswahl");
      } else if (node.config.portalMode === "existing") {
        if (node.routeNumber || node.targetNumber) checks.push("Vorhandener Sprachdialog gewählt");
        else problems.push("Vorhandener Sprachdialog fehlt");
      } else {
        if (node.config.announcement) checks.push("Sprachdialog hat Ansage");
        else problems.push("Sprachdialog braucht eine Ansage");
        if (ivrKeyNumbers(node).some((key) => !isMissingFlowNode(branchTargetNode(node, ivrTargetField(key))))) checks.push("Sprachdialog hat Tasten-Ziel");
        else problems.push("Sprachdialog braucht mindestens ein Tasten-Ziel");
        if (!isMissingFlowNode(branchTargetNode(node, "timeoutTarget"))) checks.push("Sprachdialog hat Timeout-Ziel");
        else problems.push("Sprachdialog braucht ein Timeout-Ziel");
      }
    }
    if (["QUEUE", "GROUP", "SKILL"].includes(kind)) {
      if (!node.config.portalMode) {
        problems.push(`${readableNodeType(kind)} braucht Neu oder Auswahl`);
      } else if (node.config.portalMode === "existing" && !(node.routeNumber || node.targetNumber)) {
        problems.push(`Vorhandene ${readableNodeType(kind)} fehlt`);
      }
    }
    if (kind === "ANNOUNCEMENT") {
      if (node.config.announcement) checks.push("Ansage gewählt");
      else problems.push("Ansage-Schritt braucht eine Ansage");
    }
    if (kind === "QUEUE" && node.config.timeoutSeconds) {
      checks.push(`Queue-Timeout ${node.config.timeoutSeconds}s`);
      if (!isMissingFlowNode(branchTargetNode(node, "timeoutTarget"))) checks.push("Queue hat Timeout-Ziel");
      else problems.push("Queue braucht ein Ziel nach Timeout");
    }
    if (kind === "PLACEHOLDER") {
      problems.push("Offener Pfad braucht einen Schritt");
    }
  }

  const targetReady = Boolean(target?.title && (target?.routeNumber || target?.targetNumber || target?.type === "HANGUP"));
  const liveCapable = Boolean(did) && (complex || targetReady);
  if (problems.length) checks.push(...problems);
  else checks.push(liveCapable ? (complex ? "Portal-Objekte live anlegbar" : "live übernehmbar") : "vollständiger Entwurf");

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
    <div class="empty-state">Nebenstellen-Aktionen liegen jetzt im Bereich Nebenstellen.</div>
  `;
}

function extensionActionMarkup() {
  const extension = selectedExtension();
  const nextNumber = nextExtensionNumber(extension);
  const mode = state.extensionActionMode === "create" ? "create" : "clone";
  const cloneForm = `
    <form class="action-form" id="clone-form">
      <label>Vorlage
        <input value="${escapeHtml(extension ? `${extension.number} ${extension.name}` : "Keine Auswahl")}" disabled>
      </label>
      <label>Neue Nummer
        <input name="extensionNumber" value="${escapeHtml(nextNumber)}" required>
      </label>
      <label>Name
        <input name="displayName" value="${escapeHtml(extension ? `${extension.name} Kopie` : "Neue Nebenstelle")}" required>
      </label>
      <button class="primary-button" type="submit">Kopie vorbereiten</button>
    </form>
  `;
  const createForm = `
    <form class="action-form" id="create-form">
      <label>Nummer
        <input name="extensionNumber" value="299" required>
      </label>
      <label>Name
        <input name="displayName" value="Neue Nebenstelle" required>
      </label>
      <button class="secondary-button" type="submit">Neue Nebenstelle vorbereiten</button>
    </form>
  `;
  return `
    <div class="extension-action-layout">
      <button class="extension-action-choice ${mode === "clone" ? "is-active" : ""}" type="button" data-extension-action-mode="clone">
        <strong>Einrichtung kopieren</strong>
        <span>Kopie der ausgewählten Nebenstelle vorbereiten.</span>
      </button>

      <button class="extension-action-choice ${mode === "create" ? "is-active" : ""}" type="button" data-extension-action-mode="create">
        <strong>Neue Nebenstelle</strong>
        <span>Neue Nebenstelle vorbereiten.</span>
      </button>

      <section class="assistant-card extension-action-editor">
        <h3>${mode === "clone" ? "Einrichtung kopieren" : "Neue Nebenstelle"}</h3>
        <p>${mode === "clone" ? "Bereitet eine Kopie der ausgewählten Nebenstelle vor. Es wird nichts im Portal gespeichert." : "Bereitet eine neue Nebenstelle vor. Es wird nichts im Portal gespeichert."}</p>
        ${mode === "clone" ? cloneForm : createForm}
      </section>
    </div>
  `;
}

function renderActionPlan() {
  const extensionPlanCard = $("#extension-action-plan-card");
  const showExtensionPlan = Boolean(state.actionPlan && state.actionPlan.context === "extensions");
  if (extensionPlanCard) {
    extensionPlanCard.hidden = !showExtensionPlan;
  }
  const targets = ["#action-plan", showExtensionPlan ? "#extension-action-plan" : ""]
    .filter(Boolean)
    .map((selector) => $(selector))
    .filter(Boolean);
  if (!targets.length) return;
  if (!state.actionPlan) {
    targets.forEach((target) => {
      target.innerHTML = `<div class="empty-state">Keine vorbereitete Änderung.</div>`;
    });
    return;
  }

  const body = state.actionPlan.body || {};
  const isFlowPlan = Boolean(state.actionPlan.flow);
  const isProfilePlan = state.actionPlan.type === "profile";
  const isPhonebookPlan = state.actionPlan.type === "phonebook-sync";
  const writesEnabled = liveWritesEnabled();
  const hasApplyPayload = Boolean(state.actionPlan.applyPayload);
  const canApplyFlow = isFlowPlan && hasApplyPayload && !state.actionPlan.applied && writesEnabled;
  const canApplyProfile = isProfilePlan
    && state.actionPlan.applyPayload?.changes?.length
    && !state.actionPlan.applied
    && state.actionPlan.ok !== false
    && writesEnabled;
  const checklist = isPhonebookPlan
    ? [
      `Quelle: ${state.actionPlan.source?.googleContacts ?? 0} Kontakte / ${state.actionPlan.source?.googlePhones ?? 0} Telefonnummern`,
      `NFON: ${state.actionPlan.target?.portalEntries ?? 0} Telefonbuch-Einträge in ${state.actionPlan.target?.phoneBook || "Telefonbuch"}`,
      `Differenz: ${state.actionPlan.summary?.create ?? 0} neu, ${state.actionPlan.summary?.update ?? 0} ändern, ${state.actionPlan.summary?.unchanged ?? 0} unverändert`,
      state.actionPlan.applied ? "Änderungen wurden an die Portal API gesendet." : "Übernahme erfolgt direkt im Telefonbuch-Sync.",
    ]
    : isProfilePlan
    ? [
      `${state.actionPlan.changeCount || 0} Rufnummer${state.actionPlan.changeCount === 1 ? "" : "n"} prüfen.`,
      ...(state.actionPlan.changes || []).slice(0, 4).map((change) => `${change.before || "-"} / ${change.after || "-"}`),
      state.actionPlan.applied ? "Profil wurde live an die Portal API gesendet." : "Live-Übernahme erst nach Bestätigung.",
    ]
    : isFlowPlan
    ? [
      `Callflow für ${state.actionPlan.did || "die gewählte Rufnummer"} prüfen.`,
      `Vorher: ${state.actionPlan.before || "-"}`,
      `Entwurf: ${state.actionPlan.after || "-"}`,
      state.actionPlan.applied ? "Änderung wurde live an die Portal API gesendet." : "Live-Übernahme erst nach Bestätigung.",
    ]
    : [
      `Nebenstelle ${body.extensionNumber || "neu"} mit Name ${body.displayName || "-"} vorbereiten.`,
      "Vor dem echten Speichern Geräte, Rufnummern und Callflow prüfen.",
      "Live-Übernahme erfolgt erst nach separater Freigabe.",
    ];
  const statusLabel = state.actionPlan.ok === false
    ? "Fehler"
    : state.actionPlan.blocked
      ? "Hinweis"
    : state.actionPlan.applied
      ? "live übernommen"
      : "prüfen";
  const html = `
    <div class="plan-summary">
      <span class="pill ${state.actionPlan.ok === false ? "is-error" : state.actionPlan.blocked ? "is-warning" : ""}">${escapeHtml(statusLabel)}</span>
      <strong>${escapeHtml(state.actionPlan.title || "Änderung vorbereitet")}</strong>
      <span>${escapeHtml(state.actionPlan.message || "Es wurde nichts im Portal gespeichert.")}</span>
      <ol class="check-list">
        ${checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ol>
      ${canApplyFlow ? `<button class="primary-button" id="apply-flow-live" type="button">Flow live übernehmen</button>` : ""}
      ${canApplyProfile ? `<button class="primary-button" id="apply-profile-live" type="button">Profil live übernehmen</button>` : ""}
      ${((hasApplyPayload || isPhonebookPlan) && !writesEnabled && !state.actionPlan.applied) ? `<span class="plan-note">${escapeHtml(liveWritesDisabledText())}</span>` : ""}
      ${isPhonebookPlan ? `
        <div class="sync-action-preview">
          ${(state.actionPlan.actions || []).slice(0, 8).map((action) => `
            <div class="sync-action-row">
              <span>${escapeHtml(action.action === "create-phonebook" ? "Telefonbuch" : action.action === "create" ? "Anlegen" : "Aktualisieren")}</span>
              <strong>${escapeHtml(action.contact || "-")}</strong>
              <small>${escapeHtml(action.phone || "")}</small>
            </div>
          `).join("") || `<div class="empty-state is-compact">Keine Änderung am Telefonbuch nötig.</div>`}
        </div>
      ` : ""}
      <details>
        <summary>Technische Details</summary>
        <pre>${escapeHtml(JSON.stringify(state.actionPlan, null, 2))}</pre>
      </details>
    </div>
  `;
  targets.forEach((target) => {
    target.innerHTML = html;
  });
}

function renderFlowFeedback() {
  const feedback = $("#flow-feedback");
  if (!feedback) return;
  const plan = state.view === "callflow" && state.actionPlan?.context === "callflow" ? state.actionPlan : null;
  const complexSaved = Boolean(plan?.flow && !plan.applyPayload && plan.ok !== false);
  const hasLocalDraft = !plan && Boolean(state.flow?.draftUpdatedAt);
  const selected = selectedDid();
  const message = plan
    ? {
      ok: plan.ok !== false,
      title: selectedDidHeadline(selected),
      message: plan.message || "",
    }
    : state.flowFeedback || {
      ok: true,
      title: selectedDidHeadline(selected),
      message: state.flow?.draftUpdatedAt
        ? `Lokaler Entwurf geladen (${formatTime(state.flow.draftUpdatedAt)}).`
        : state.flow?.appliedSnapshotAt
          ? `Live-Änderung geladen (${formatTime(state.flow.appliedSnapshotAt)}). Die Detailstruktur stammt aus dem übernommenen Flow.`
        : "Live-Zustand geladen. Änderungen bleiben lokal bis zur Prüfung.",
    };
  feedback.className = `flow-feedback ${message.ok ? "is-ok" : "is-error"}`;
  feedback.innerHTML = `
    <div class="flow-feedback-copy">
      <button class="flow-did-selector" id="flow-did-selector" type="button" aria-expanded="false">
        <strong>${escapeHtml(message.title)}</strong>
        <span aria-hidden="true">⌄</span>
      </button>
      <span>${escapeHtml(message.message || "")}</span>
      <div class="flow-did-menu" id="flow-did-menu" hidden>
        ${(getOverview()?.inventory?.dids || []).map((did) => `
          <button class="flow-did-option ${did.id === state.selectedDidId ? "is-selected" : ""}" type="button" data-did-id="${escapeHtml(did.id)}">
            <strong>${escapeHtml(did.name || did.value || "Rufnummer")}</strong>
            <span>${escapeHtml(did.value || did.destinationName || "kein Ziel erkannt")}</span>
          </button>
        `).join("")}
      </div>
    </div>
    ${complexSaved ? `<span class="pill">Lokal gespeichert</span>` : ""}
    ${complexSaved ? `<button class="secondary-button is-compact" id="save-flow-draft-from-plan" type="button">Erneut speichern</button>` : ""}
  `;
  const clearDraftButton = $("#clear-flow-draft");
  if (clearDraftButton) clearDraftButton.hidden = !hasLocalDraft;
}

function selectedDidHeadline(did = selectedDid()) {
  if (!did) return "Keine Rufnummer ausgewählt";
  return did.name || did.value || "Rufnummer";
}

function renderFlowProfileActions() {
  const target = $(".flow-profile-actions");
  if (!target) return;
  const choices = parsedDaynightTargetOptions();
  ensureProfileTargetValue(choices);
  const standardProfile = readProfile("standard");
  target.innerHTML = `
    <button class="secondary-button" id="save-standard-flow-profile" type="button">Standard sichern</button>
    <button class="secondary-button" id="stage-standard-flow-profile" type="button">Standard wiederherstellen</button>
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
        label: "Zeitsteuerungen",
        ok: endpoint?.ok || (overview?.inventory?.timeControls || []).length > 0,
        detail: endpoint?.ok
          ? `${overview?.counts?.timeControls || 0} geladen`
          : endpoint?.error || "nicht geladen",
      },
      {
        label: "Nachtziel",
        ok: Boolean(target),
        detail: target ? `${displayTargetName(target.type, target.title) || target.type} ${target.routeNumber || target.targetNumber || ""}`.trim() : "kein Ziel gewählt",
      },
      {
        label: "Standardprofil",
        ok: Boolean(standardProfile),
        detail: standardProfile ? `gesichert ${formatProfileTime(standardProfile)}` : "noch nicht gesichert",
      },
      {
        label: "Rufnummern",
        ok: didCount > 0,
        detail: `${didCount} Rufnummer${didCount === 1 ? "" : "n"} verfügbar`,
      },
    ];
    const statusTitle = standardProfile ? "Standardprofil gesichert" : "Standardprofil fehlt";
    const statusDetail = standardProfile
      ? "Nachtmodus kann geprüft und später auf Standard zurückgestellt werden."
      : "Aktuellen Zustand zuerst als Standard sichern.";
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
      && summary.total > 0
      && summary.gatewaysExisting === summary.total
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
  toggle.disabled = state.daynightModeSwitchLoading || state.daynightGatewayRoutingLoading || state.daynightGatewayResetLoading;
  text.textContent = state.daynightModeSwitchLoading ? "Bitte warten..." : state.daynightActive ? "☾ Nachtmodus aktiv" : "☀ Tagmodus";
  const title = state.daynightActive
    ? "Tagmodus wiederherstellen"
    : "Nachtmodus aktivieren";
  switchLabel.title = title;
  toggle.setAttribute("aria-label", title);
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
          <strong>Zeitsteuerungs-Plan noch nicht geprüft</strong>
          <span>${escapeHtml(requiresDialogCreation ? "Lege zuerst den neuen Sprachdialog als Nachtziel an. Danach kann der Zeitsteuerungs-Plan geprüft werden." : "Schritt 1 liest nur API-Daten. Zeitsteuerungen und Rufnummern bleiben unverändert.")}</span>
        </div>
        <div class="daynight-action-row">
          <button class="secondary-button" id="preview-daynight-gateway" type="button" ${state.daynightGatewayLoading || requiresDialogCreation ? "disabled" : ""}>${state.daynightGatewayLoading ? "Prüft..." : "Zeitsteuerungs-Plan prüfen"}</button>
        </div>
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
            <h3>${escapeHtml(preview.title || "Neues Nachtziel geprüft")}</h3>
            <p>${escapeHtml(preview.message || "")}</p>
          </div>
          <span class="batch-status-pill ${preview.ok ? "is-ok" : "is-warning"}">Plan</span>
        </div>
        ${gatewayTargetControlMarkup()}
        ${preview.ok ? `
          <div class="readiness-item is-ok">
            <strong>Nächster Schritt</strong>
            <span>Lege das neue Nachtziel an. Danach wird es automatisch als Nachtziel ausgewählt und der Zeitsteuerungs-Plan kann geprüft werden.</span>
          </div>
        ` : `
          <div class="readiness-item is-warning">
            <strong>Bitte korrigieren</strong>
            <span>${escapeHtml((preview.blockers || []).join(" ") || "Der Plan ist noch nicht vollständig.")}</span>
          </div>
        `}
      </section>
    `;
    updateDaynightHeaderButton();
    return;
  }
  const summary = preview.summary || {};
  const writesEnabled = liveWritesEnabled();
  const gatewayChangeCount = (summary.gatewaysToCreate || 0) + (summary.gatewaysToUpdate || 0);
  const canCreateGateways = Boolean(preview.ok && gatewayChangeCount > 0 && writesEnabled && !state.daynightGatewayApplyLoading);
  const allGatewaysReady = Boolean(preview.ok && summary.total > 0 && summary.gatewaysExisting === summary.total);
  const canRouteGateways = Boolean(allGatewaysReady && writesEnabled && !state.daynightGatewayRoutingLoading);
  const cleanupCount = summary.cleanupCandidates || preview.staleTimeControls?.length || 0;
  const managedGatewayCount = summary.gatewaysExisting || 0;
  const canCleanupGateways = Boolean((cleanupCount > 0 || managedGatewayCount > 0) && writesEnabled && !state.daynightGatewayCleanupLoading && !state.daynightGatewayResetLoading);
  const canResetGateways = Boolean(managedGatewayCount > 0 && writesEnabled && !state.daynightGatewayResetLoading);
  const cleanupButtonLabel = cleanupCount > 0 ? "Alte Zeitsteuerungen löschen" : "Zeitsteuerungen löschen";
  const capabilities = preview.capabilities || {};
  const operationFeedback = state.daynightOperationFeedback;
  const capabilityRows = [
    ["Rufnummern", capabilities.dids],
    ["Zeitsteuerungen", capabilities.timeControls],
    ["Sprachdialoge", capabilities.ivrs],
    ["Ansagen", capabilities.announcements],
    ["Frontdesk/Nia", capabilities.frontdesks],
  ];
  target.innerHTML = `
    <section class="daynight-preview-card">
      <div class="daynight-preview-header">
        <div>
          <h3>${escapeHtml(preview.title || "Zeitsteuerungs-Check")}</h3>
          <p>${escapeHtml(preview.message || "")}</p>
        </div>
        <span class="batch-status-pill ${preview.ok ? "is-ok" : "is-warning"}">${preview.readOnly ? "Read-only" : "Plan"}</span>
      </div>
      ${gatewayTargetControlMarkup()}
      <div class="daynight-step-grid">
        <div class="daynight-step ${preview.ok ? "is-ok" : "is-current"}">
          <span>1</span>
          <strong>Plan prüfen</strong>
          <small>${escapeHtml(preview.ok ? "API-Daten eindeutig" : "Blocker prüfen")}</small>
        </div>
        <div class="daynight-step ${allGatewaysReady ? "is-ok" : gatewayChangeCount ? "is-current" : ""}">
          <span>2</span>
          <strong>Zeitsteuerungen anlegen/aktualisieren</strong>
          <small>${escapeHtml(`${summary.gatewaysReady || 0} passend, ${summary.gatewaysToCreate || 0} neu, ${summary.gatewaysToUpdate || 0} Ziel ändern`)}</small>
        </div>
        <div class="daynight-step ${allGatewaysReady ? "is-current" : ""}">
          <span>3</span>
          <strong>Rufnummern umhängen</strong>
          <small>${escapeHtml(allGatewaysReady ? "separater Live-Schritt" : "erst nach Zeitsteuerungs-Anlage")}</small>
        </div>
      </div>
      <div class="daynight-action-row">
        <button class="secondary-button" id="preview-daynight-gateway" type="button" ${state.daynightGatewayLoading || requiresDialogCreation ? "disabled" : ""}>${state.daynightGatewayLoading ? "Prüft..." : "Plan erneut prüfen"}</button>
        <button class="primary-button" id="apply-daynight-gateways" type="button" ${canCreateGateways ? "" : "disabled"}>${state.daynightGatewayApplyLoading ? "Zeitsteuerungen werden geschrieben..." : "Zeitsteuerungen anlegen/aktualisieren"}</button>
        <button class="secondary-button" id="cleanup-daynight-time-controls" type="button" ${canCleanupGateways ? "" : "disabled"}>${state.daynightGatewayCleanupLoading || state.daynightGatewayResetLoading ? "Löscht..." : cleanupButtonLabel}</button>
        <button class="secondary-button" id="reset-daynight-time-controls" type="button" ${canResetGateways ? "" : "disabled"}>${state.daynightGatewayResetLoading ? "Setzt zurück..." : "Nachtschaltung zurücksetzen"}</button>
        <button class="danger-button" id="apply-daynight-gateway-routing" type="button" ${canRouteGateways ? "" : "disabled"}>${state.daynightGatewayRoutingLoading ? "Rufnummern werden umgehängt..." : "Rufnummern auf Zeitsteuerungen umhängen"}</button>
      </div>
      ${operationFeedback ? `
        <div class="readiness-item ${operationFeedback.ok ? "is-ok" : "is-warning"}">
          <strong>${escapeHtml(operationFeedback.title)}</strong>
          <span>${escapeHtml([
            operationFeedback.message,
            ...(operationFeedback.details || []),
            operationFeedback.appliedAt ? `um ${formatTime(operationFeedback.appliedAt)}` : "",
          ].filter(Boolean).join(" · "))}</span>
        </div>
      ` : ""}
      ${!writesEnabled ? `<div class="readiness-item is-warning"><strong>Live-Schreiben aus</strong><span>${escapeHtml(liveWritesDisabledText())}</span></div>` : ""}
      <div class="sync-stat-grid">
        <div><span>Rufnummern</span><strong>${escapeHtml(summary.total || 0)}</strong></div>
        <div><span>Bereit</span><strong>${escapeHtml(summary.ready || 0)}</strong></div>
        <div><span>Zeitsteuerungen offen</span><strong>${escapeHtml(summary.gatewaysToCreate || 0)}</strong></div>
        <div><span>Ziel ändern</span><strong>${escapeHtml(summary.gatewaysToUpdate || 0)}</strong></div>
        <div><span>Cleanup</span><strong>${escapeHtml(cleanupCount)}</strong></div>
      </div>
      ${cleanupCount ? `
        <div class="readiness-item is-warning">
          <strong>Namenskonvention ${escapeHtml(preview.namingConvention || "TN <Rufnummer>")}</strong>
          <span>${escapeHtml(`${cleanupCount} nicht mehr benötigte Zeitsteuerung${cleanupCount === 1 ? "" : "en"} können gelöscht werden.`)}</span>
        </div>
      ` : ""}
      <div class="daynight-capabilities">
        ${capabilityRows.map(([label, item]) => `
          <div class="readiness-item ${item?.ok ? "is-ok" : "is-warning"}">
            <strong>${escapeHtml(label)}</strong>
            <span>${escapeHtml(item?.ok ? `${item.count || 0} geladen` : item?.error || "nicht geladen")}</span>
          </div>
        `).join("")}
      </div>
      <div class="daynight-preview-table">
        <div class="daynight-preview-table-head" role="row">
          <span>Rufnummer</span>
          <span>Aktuelles Tagesziel</span>
          <span>Zeitsteuerung</span>
          <span>Nachtziel</span>
          <span>Bewertung</span>
        </div>
        ${(preview.entries || []).map((entry) => `
          <article class="daynight-preview-row ${entry.ok ? "" : "is-warning"}" role="row">
            <div data-label="Rufnummer">
              <strong>${escapeHtml(entry.did?.name || entry.did?.id || "-")}</strong>
              <small>${escapeHtml(entry.did?.trunkNumber || "")}</small>
            </div>
            <div data-label="Aktuelles Tagesziel">
              <strong>${escapeHtml(entry.currentTarget?.label || "-")}</strong>
              <small>${escapeHtml(`${targetTypeLabel(entry.currentTarget?.type)} ${entry.currentTarget?.routeNumber || ""}`.trim())}</small>
            </div>
            <div data-label="Zeitsteuerung">
              <strong>${escapeHtml(entry.gateway?.name || "-")}</strong>
              <small>${escapeHtml(entry.gatewayExists ? `${entry.gatewayNeedsUpdate ? "Ziel aktualisieren" : "passend"} · Zeitsteuerung ${entry.gateway?.extensionNumber || ""}`.trim() : `neu · Zeitsteuerung ${entry.gateway?.extensionNumber || ""}`.trim())}</small>
            </div>
            <div data-label="Nachtziel">
              <strong>${escapeHtml(displayTargetName(preview.nightTarget?.type, preview.nightTarget?.title) || "Nachtziel")}</strong>
              <small>${escapeHtml(`${targetTypeLabel(preview.nightTarget?.type)} ${preview.nightTarget?.routeNumber || ""}`.trim())}</small>
            </div>
            <div data-label="Bewertung">
              <strong>${escapeHtml(entry.ok ? "prüfbar" : "Blocker")}</strong>
              <small>${escapeHtml(entry.blockers?.length ? entry.blockers.join(", ") : entry.behaviorNote || "")}</small>
            </div>
          </article>
        `).join("")}
      </div>
      ${(preview.blockers || []).length ? `
        <div class="readiness-item is-warning">
          <strong>Blocker vor Live-Migration</strong>
          <span>${escapeHtml(preview.blockers.join(" | "))}</span>
        </div>
      ` : ""}
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
  const writesEnabled = liveWritesEnabled();
  button.disabled = state.phonebookSyncLoading;
  button.textContent = state.phonebookSyncLoading ? "Lädt..." : "Übernehmen";
  const summaryData = visiblePlan?.summary || {};
  const changeCount = Number(summaryData.create || 0) + Number(summaryData.update || 0);
  const hasChanges = changeCount > 0 && visiblePlan?.ok !== false && !visiblePlan?.applied;
  const isSynced = visiblePlan?.ok !== false && changeCount === 0 && visiblePlan && !visiblePlan.results?.length;
  const statusTitle = visiblePlan?.applied
    ? "Änderungen übernommen"
    : isSynced
      ? "Alles synchron"
      : visiblePlan?.title || "Bereit zum Prüfen";
  const statusMessage = visiblePlan?.applied
    ? visiblePlan.message || "Die Änderungen wurden an die Portal API gesendet."
    : isSynced
      ? `${summaryData.unchanged || 0} Einträge sind bereits synchron. Es gibt nichts zu übernehmen.`
      : visiblePlan?.message || "Kontaktquelle und NFON-Kontakte können abgeglichen werden.";
  const nfonRows = visiblePlan?.preview?.nfon?.length
    ? visiblePlan.preview.nfon
    : phonebookInventoryRows(overview?.inventory?.phoneBooks || []);
  const googleFile = settings.googleContactsFile || visiblePlan?.source?.file || "";
  const googleSourceLabel = googleFile
    ? googleFile.split(/[\\/]/).filter(Boolean).pop() || "Kontaktdatei"
    : "";
  const sourceDisplayLabel = googleSourceLabel && googleSourceLabel.toLowerCase().includes("google")
    ? "lokale Kontaktquelle"
    : googleSourceLabel;
  const uploadFeedback = state.phonebookUploadFeedback;
  const manualPending = state.phonebookManualDirty && collectManualPhonebookRows().length > 0;

  summary.innerHTML = `
    <div class="phonebook-workspace">
      <section class="phonebook-fixed-grid">
        <form class="phonebook-card phonebook-upload-form" id="phonebook-upload-form">
          <div>
            <span class="step-label">Quelle</span>
            <h3>Telefonbuch Upload</h3>
            <p class="helper-copy">CSV / JSON</p>
          </div>
          <div class="phonebook-file-row">
            <label class="phonebook-file-picker" for="phonebook-upload-file">
              <span>Datei auswählen</span>
              <strong id="phonebook-upload-file-name"></strong>
            </label>
            <button class="phonebook-format-help-button" id="phonebook-format-help-toggle" type="button" aria-label="Format-Hilfe anzeigen" aria-expanded="${state.phonebookFormatHelpOpen ? "true" : "false"}" aria-controls="phonebook-format-help">i</button>
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
                <span>Array oder contacts-Liste</span>
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
          <button class="secondary-button" type="submit">Datei übernehmen</button>
          <div class="phonebook-source-state">
            <strong>Aktive Quelle</strong>
            <span>${escapeHtml(sourceDisplayLabel || "keine lokale Quelle")}</span>
          </div>
          <div class="phonebook-manual-panel">
            <div>
              <span class="step-label">Manuell</span>
              <h4>Kontakt hinzufügen</h4>
            </div>
            <div class="phonebook-manual-grid">
              <label>Vorname
                <input data-phonebook-manual-field="firstName" value="${escapeHtml(state.phonebookManualDraft.firstName)}" placeholder="optional">
              </label>
              <label>Name
                <input data-phonebook-manual-field="name" value="${escapeHtml(state.phonebookManualDraft.name)}" placeholder="Name">
              </label>
              <label>Rufnummer
                <input data-phonebook-manual-field="phone" value="${escapeHtml(state.phonebookManualDraft.phone)}" placeholder="+49 ...">
              </label>
            </div>
            <button class="secondary-button" id="add-phonebook-manual-contact" type="button">Kontakt hinzufügen</button>
            <div class="phonebook-manual-list">
              ${state.phonebookManualRows.length ? state.phonebookManualRows.map((row, index) => `
                <div class="phonebook-manual-row">
                  <strong>${escapeHtml([row.firstName, row.name].filter(Boolean).join(" ") || "Kontakt")}</strong>
                  <span>${escapeHtml(row.phone)}</span>
                  <button class="icon-button" data-phonebook-manual-remove="${index}" type="button" aria-label="Kontakt entfernen">×</button>
                </div>
              `).join("") : `<div class="empty-state is-compact">Noch keine manuellen Kontakte.</div>`}
            </div>
          </div>
          ${uploadFeedback ? `<div class="sync-note ${uploadFeedback.ok ? "" : "is-warning"}"><strong>${escapeHtml(uploadFeedback.title)}</strong><span>${escapeHtml(uploadFeedback.message)}</span></div>` : ""}
          ${manualPending ? `
            <div class="sync-note">
              <strong>Manuelle Kontakte bereit</strong>
              <span>Oben rechts mit Übernehmen als lokale Quelle setzen und mit dem NFON-Telefonbuch abgleichen.</span>
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
              <button class="primary-button" id="apply-phonebook-sync-live" type="button" ${writesEnabled ? "" : "disabled"}>Änderungen übernehmen</button>
              <span>${escapeHtml(writesEnabled ? `${changeCount} Änderung${changeCount === 1 ? "" : "en"} werden live in der Portal API gespeichert.` : "Live-Schreiben ist global in Settings deaktiviert.")}</span>
            </div>
          ` : ""}
        </form>

        <section class="phonebook-card phonebook-current-card">
          <div class="phonebook-preview-header">
            <div>
              <span class="step-label">NFON</span>
              <h3>Aktuelles Telefonbuch</h3>
            </div>
            <strong>${escapeHtml(nfonRows.length || visiblePlan?.target?.portalEntries || overview?.counts?.phoneBooks || 0)} Einträge</strong>
          </div>
          <div class="phonebook-table">
            ${renderPhonebookPreviewRows(nfonRows, "nfon")}
          </div>
        </section>
      </section>

      ${(visiblePlan?.results || []).length ? `
        <section class="phonebook-card">
          <div class="phonebook-preview-header">
            <h3>Übernahme-Protokoll</h3>
          </div>
          <div class="sync-action-preview">
            ${(visiblePlan.results || []).slice(0, 8).map((result) => `
              <div class="sync-action-row ${result.ok ? "" : "is-error"}">
                <span>${escapeHtml(result.ok ? "Gespeichert" : "Fehler")}</span>
                <strong>${escapeHtml(result.contact || result.action || "-")}</strong>
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
    return `<div class="empty-state is-compact">${source === "google" ? "Noch keine API-Kontakte geladen." : "Keine NFON-Kontakte geladen."}</div>`;
  }
  return rows.slice(0, 60).map((row) => `
    <div class="phonebook-row">
      <span class="phonebook-row-state is-${escapeHtml(row.status || "present")}">${escapeHtml(phonebookStatusLabel(row.status, source))}</span>
      <strong>${escapeHtml(row.contact || "-")}</strong>
      <span>${escapeHtml(row.phone || "-")}</span>
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
      contact: entry.name || "Telefonbuch-Eintrag",
      phone: primaryPhone.value || primaryPhone.normalized || "-",
      book: entry.bookName || "NFON Telefonbuch",
    };
  });
}

function phonebookStatusLabel(status, source) {
  return {
    create: "Neu",
    update: "Ändern",
    unchanged: "OK",
    skipped: "Skip",
    present: "NFON",
    unmapped: "NFON",
    "no-phone": "Ohne Nr.",
  }[status] || (source === "google" ? "Quelle" : "NFON");
}

function addManualPhonebookContact() {
  const draft = {
    firstName: normalizePhonebookText(state.phonebookManualDraft.firstName),
    name: normalizePhonebookText(state.phonebookManualDraft.name),
    phone: String(state.phonebookManualDraft.phone || "").trim(),
  };
  if (!draft.name || !draft.phone) {
    state.phonebookUploadFeedback = { ok: false, title: "Kontakt unvollständig", message: "Name und Rufnummer sind Pflichtfelder." };
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

async function persistManualPhonebookContacts() {
  const rows = collectManualPhonebookRows();
  if (!rows.length) return false;
  const contacts = rows.map((row, index) => ({
    id: `manual-${index + 1}`,
    firstName: row.firstName,
    name: [row.firstName, row.name].filter(Boolean).join(" ") || row.name,
    phones: row.phone,
  }));
  const result = await fetchJson("/api/phonebook-sync/upload", {
    method: "POST",
    body: JSON.stringify({ contacts, source: "manuelle-kontakte", syncedAt: new Date().toISOString() }),
  });
  if (state.overview) state.overview.settings = result.settings;
  state.phonebookManualRows = rows;
  state.phonebookManualDraft = { firstName: "", name: "", phone: "" };
  state.phonebookManualDirty = false;
  state.phonebookUploadFeedback = {
    ok: true,
    title: "Manuelle Kontakte aktiv",
    message: `${result.contacts} Kontakt${result.contacts === 1 ? "" : "e"} werden als lokale Quelle verwendet.`,
  };
  return true;
}

function renderLegacyPhonebookSync() {
  const summary = $("#phonebook-sync-summary");
  const button = $("#stage-phonebook-sync");
  if (!summary || !button) return;
  const overview = getOverview();
  const plan = state.actionPlan?.type === "phonebook-sync" ? state.actionPlan : null;
  const writesEnabled = liveWritesEnabled();
  button.disabled = state.phonebookSyncLoading;
  button.textContent = state.phonebookSyncLoading ? "Lädt..." : "Übernehmen";

  if (plan) {
    const summaryData = plan.summary || {};
    const changeCount = Number(summaryData.create || 0) + Number(summaryData.update || 0);
    const hasChanges = changeCount > 0 && plan.ok !== false && !plan.applied;
    const isSynced = plan.ok !== false && changeCount === 0 && !plan.results?.length;
    const statusTitle = plan.applied
      ? "Änderungen übernommen"
      : isSynced
        ? "Alles synchron"
        : plan.title || "Telefonbuch-Sync";
    const statusMessage = plan.applied
      ? plan.message || "Die Änderungen wurden an die Portal API gesendet."
      : isSynced
        ? `${summaryData.unchanged || 0} Einträge sind bereits synchron. Es gibt nichts zu übernehmen.`
        : plan.message || "Differenzen wurden ermittelt.";
    summary.innerHTML = `
      <div class="sync-stat-grid">
        <div class="sync-stat">
          <span>Quelle</span>
          <strong>${escapeHtml(plan.source?.googleContacts ?? "-")}</strong>
          <small>${escapeHtml(plan.source?.googleSyncedAt ? `Cache ${formatTime(plan.source.googleSyncedAt)}` : "Kontaktquelle")}</small>
        </div>
        <div class="sync-stat">
          <span>Ziel</span>
          <strong>${escapeHtml(plan.target?.portalEntries ?? "-")}</strong>
          <small>NFON Telefonbuch</small>
        </div>
        <div class="sync-stat">
          <span>Neu</span>
          <strong>${escapeHtml(summaryData.create ?? 0)}</strong>
          <small>anzulegen</small>
        </div>
        <div class="sync-stat">
          <span>Ändern</span>
          <strong>${escapeHtml(summaryData.update ?? 0)}</strong>
          <small>zu aktualisieren</small>
        </div>
      </div>
      <div class="sync-note ${plan.ok === false ? "is-warning" : ""}">
        <strong>${escapeHtml(statusTitle)}</strong>
        <span>${escapeHtml(statusMessage)}</span>
      </div>
      ${hasChanges ? `
        <div class="sync-apply-row">
          <button class="primary-button" id="apply-phonebook-sync-live" type="button" ${writesEnabled ? "" : "disabled"}>Änderungen übernehmen</button>
          <span>${escapeHtml(writesEnabled ? `${changeCount} Änderung${changeCount === 1 ? "" : "en"} werden live in der Portal API gespeichert.` : "Live-Schreiben ist global in Settings deaktiviert.")}</span>
        </div>
      ` : ""}
      ${(plan.actions || []).length ? `
        <div class="sync-action-preview">
          ${(plan.actions || []).slice(0, 8).map((action) => `
            <div class="sync-action-row">
              <span>${escapeHtml(action.action === "create" ? "Neu" : "Ändern")}</span>
              <strong>${escapeHtml(action.contact || "-")}</strong>
              <small>${escapeHtml(action.phone || "")}</small>
            </div>
          `).join("")}
        </div>
      ` : ""}
      ${(plan.results || []).length ? `
        <div class="sync-action-preview">
          ${(plan.results || []).slice(0, 8).map((result) => `
            <div class="sync-action-row ${result.ok ? "" : "is-error"}">
              <span>${escapeHtml(result.ok ? "Gespeichert" : "Fehler")}</span>
              <strong>${escapeHtml(result.contact || result.action || "-")}</strong>
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
      <strong>${escapeHtml(phoneBooks)} Telefonbuch${phoneBooks === 1 ? "" : "er"} in der Portal API</strong>
      <span>Die Vorschau liest die lokale Kontaktquelle und vergleicht Telefonnummern gegen das NFON-Telefonbuch. Es wird nichts live geschrieben.</span>
    </div>
  `;
}

function renderSettingsSummary() {
  const target = $("#settings-summary");
  if (!target) return;
  const overview = getOverview();
  const settings = overview?.settings || {};
  const account = visibleAccount(overview);
  target.innerHTML = `
    <div class="settings-grid">
      <div class="settings-card settings-status-card ${settings.configured ? "is-ok" : "is-warning"}">
        <div class="settings-card-header">
          <span>Status</span>
          <strong>${settings.configured ? "Bereit" : "Prüfen"}</strong>
        </div>
        <div class="settings-card-body">
          <div class="settings-meta-row settings-account-row">
            <strong>${escapeHtml(account || "Anmeldung erforderlich")}</strong>
          </div>
        </div>
      </div>
      <div class="settings-card settings-live-card ${settings.liveWritesEnabled ? "is-warning" : "is-ok"}">
        <div class="settings-card-header">
          <span>Sicherheit</span>
          <strong>${settings.liveWritesEnabled ? "Schreibschutz (AUS)" : "Schreibschutz (AN)"}</strong>
        </div>
        <div class="settings-card-body">
          <div class="settings-control-row settings-control-row-toggle-only">
            <button class="settings-live-switch ${settings.liveWritesEnabled ? "is-on" : ""}" data-live-writes="${settings.liveWritesEnabled ? "off" : "on"}" type="button" ${state.liveWritesSaving || !settings.configured ? "disabled" : ""} aria-pressed="${settings.liveWritesEnabled ? "true" : "false"}" aria-label="${settings.liveWritesEnabled ? "Live-Schreiben deaktivieren" : "Live-Schreiben aktivieren"}">
              <span class="settings-live-switch-track" aria-hidden="true"><span></span></span>
            </button>
          </div>
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
  const activeSource = settings.browserCredentialsActive ? "Browser-Login aktiv" : settings.sources?.environment ? ".env aktiv" : "Lokale Secret-Datei aktiv";
  const envActive = mode !== "browser";
  const configured = Boolean(settings.configured);
  const envExample = [
    "PORTAL_BASE_URL=https://portal-api.nfon.net:8090",
    "PORTAL_API_KEY_ID=...",
    "PORTAL_API_KEY_SECRET=...",
    "PORTAL_CUSTOMER_ACCOUNT=<ANLAGENNUMMER>",
  ].join("\n");
  target.innerHTML = `
    <div class="panel-header auth-login-head">
      <div>
        <h2>Anmeldung</h2>
        <p>Portal-API-Zugang per lokaler Datei oder Browser-Formular setzen.</p>
      </div>
      <span class="auth-login-state ${configured ? "is-configured" : "is-required"}">${configured ? "Zugang konfiguriert" : "Login erforderlich"}</span>
    </div>
    <div class="auth-login-body">
      <div class="auth-mode-switch" role="tablist" aria-label="Anmeldemethode">
        <button class="${envActive ? "is-active" : ""}" type="button" data-auth-login-mode="env">Login via .env</button>
        <button class="${!envActive ? "is-active" : ""}" type="button" data-auth-login-mode="browser">Login via Browser</button>
      </div>
      ${envActive ? `
        <section class="auth-login-card is-active">
          <span>Lokale Konfiguration</span>
          <h3>${escapeHtml(activeSource)}</h3>
          <p>Im Ordner <strong>Portal_API</strong> eine Datei <strong>.env</strong> anlegen. Der Server liest sie beim Start automatisch.</p>
          <pre>${escapeHtml(envExample)}</pre>
          <p>Danach den Portal-Server neu starten. Secrets bleiben lokal und werden nicht an das Frontend zurückgegeben.</p>
        </section>
      ` : `
        <form class="auth-login-card browser-login-form" id="browser-login-form">
          <span>Browser-Konfiguration</span>
          <h3>${settings.browserCredentialsActive ? "Zugang für diese Sitzung aktiv" : "Zugangsdaten für diese Sitzung setzen"}</h3>
          <div class="auth-form-grid">
            <label>Portal URL<input name="baseUrl" type="url" value="${escapeHtml(draft.baseUrl || settings.baseUrl || "https://portal-api.nfon.net:8090")}" placeholder="https://portal-api.nfon.net:8090" autocomplete="off"></label>
            <label>API Key ID<input name="apiKeyId" type="text" value="${escapeHtml(draft.apiKeyId)}" placeholder="Key ID" autocomplete="off"></label>
            <label>API Key Secret<input name="apiKeySecret" type="password" value="${escapeHtml(draft.apiKeySecret)}" placeholder="Secret" autocomplete="off"></label>
            <label>Anlage<input name="customerAccount" type="text" value="${escapeHtml(draft.customerAccount || account)}" placeholder="Anlagennummer" autocomplete="off"></label>
          </div>
          <div class="auth-form-actions">
            <button class="primary-button" type="submit" ${state.browserLoginSaving ? "disabled" : ""}>${state.browserLoginSaving ? "Prüft..." : "Browser-Login aktivieren"}</button>
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
  state.browserLoginFeedback = { ok: true, title: "Browser-Login wird geprüft", message: "Die Anlage wird mit den eingegebenen Zugangsdaten gelesen." };
  renderAuthLoginPanel();
  try {
    const result = await fetchJson("/api/settings/browser-login", {
      method: "POST",
      body: JSON.stringify(state.browserLoginDraft),
    });
    state.browserLoginDraft.apiKeySecret = "";
    state.browserLoginFeedback = { ok: true, title: "Browser-Login aktiv", message: result.message || "Zugangsdaten sind für diese Sitzung aktiv." };
    state.authLoginMode = "browser";
    resetAccountScopedState();
    await loadOverview();
  } catch (error) {
    state.browserLoginFeedback = { ok: false, title: "Browser-Login fehlgeschlagen", message: error.message };
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
        <summary>Technische Details</summary>
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
      <strong>${escapeHtml(feedback.title || "")}</strong>
      <span>${escapeHtml(feedback.message || "")}</span>
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
    serviceApplyButton.disabled = !liveWritesEnabled();
    serviceApplyButton.title = liveWritesEnabled() ? "" : liveWritesDisabledText();
  }
  const serviceUndoButton = $("#undo-service-draft");
  if (serviceUndoButton) {
    serviceUndoButton.disabled = !(state.serviceDraftHistory || []).length;
    serviceUndoButton.title = serviceUndoButton.disabled ? "Keine lokale Änderung zum Zurücknehmen." : "Letzte lokale Änderung zurücknehmen.";
  }
  feedback.hidden = !state.serviceFeedback;
  feedback.innerHTML = serviceFeedbackMarkup();
  if (filter && filter.value !== state.serviceFilter) filter.value = state.serviceFilter;

  if (!state.serviceGroups) {
    extensionList.innerHTML = `<div class="empty-state">${state.serviceLoading ? "Nebenstellen werden geladen." : "Mitgliedschaften werden automatisch geladen."}</div>`;
    board.innerHTML = `<div class="service-empty-board"><strong>${state.serviceLoading ? "Lädt" : "Bereit zum Laden"}</strong><span>Warteschlangen und Skillgruppen werden direkt aus der Portal API gelesen.</span></div>`;
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
    <div class="service-extension-card extension-row ${selectedExtensionIds.has(String(extension.id)) || selectedExtensionIds.has(String(extension.number)) ? "is-selected" : ""}" draggable="true" data-service-extension-id="${escapeHtml(extension.id)}">
      <span class="extension-number">${escapeHtml(extension.number || extension.id)}</span>
      <span class="extension-copy">
        <span class="extension-name">${escapeHtml(extension.name || "Nebenstelle")}</span>
        <span class="extension-meta">${escapeHtml(extension.type || "PHONE")}</span>
      </span>
      <span class="extension-action">Ziehen</span>
    </div>
  `).join("") || `<div class="empty-state">Keine Nebenstelle gefunden.</div>`}`;

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
    const memberCount = meta.memberCount || 0;
    const memberPreview = (entry.members || []).slice(0, 6);
    return `
      <article class="service-card ${selected ? "is-selected" : ""} ${changed ? "has-changes" : ""}" style="${serviceColorStyle(entry.color)}" data-service-card data-service-kind="${escapeHtml(kind)}" data-service-id="${escapeHtml(id)}">
        <button class="service-card-hit" type="button" data-select-service="${escapeHtml(serviceKey(kind, service))}">
          <span class="service-card-top">
            <span class="service-kind">${kind === "skill" ? "Skillgruppe" : "Warteschlange"}</span>
            <span class="service-member-count">${memberCount} Mitglied${memberCount === 1 ? "" : "er"}</span>
          </span>
          <strong>${escapeHtml(service.name || `${kind} ${id}`)}</strong>
          <small>${escapeHtml(id || "ohne Nummer")}${service.memberError ? ` · ${service.memberError}` : ""}</small>
        </button>
        <button class="node-edit-button service-edit-button" type="button" data-edit-service="${escapeHtml(serviceKey(kind, service))}" aria-label="${escapeHtml(service.name || `${kind} ${id}`)} bearbeiten">Edit</button>
        <div class="service-members">
          ${memberPreview.map((member) => `
            <div class="service-member-chip">
              <span>${escapeHtml(member.name || "Nebenstelle")} (${escapeHtml(member.extensionNumber)})</span>
              <button class="text-button" data-remove-service-member data-service-kind="${escapeHtml(kind)}" data-service-id="${escapeHtml(id)}" data-extension-number="${escapeHtml(member.extensionNumber)}" type="button">Entfernen</button>
            </div>
          `).join("")}
          ${(entry.members || []).length > memberPreview.length ? `<div class="service-member-more">+${(entry.members || []).length - memberPreview.length} weitere</div>` : ""}
          ${(entry.members || []).length ? "" : `<div class="service-drop-hint">Nebenstelle hier ablegen</div>`}
        </div>
      </article>
    `;
  }).join("");
  board.innerHTML = `
    ${serviceCards || `
      <div class="service-empty-board">
        <strong>Keine ${kind === "skill" ? "Skillgruppen" : "Warteschlangen"} gefunden.</strong>
        <span>${kind === "skill" ? "Lege oben eine Skillgruppe an." : "Lege oben eine Warteschlange an."}</span>
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
      <span class="service-kind">${selectedKind === "skill" ? "Skillgruppe" : "Warteschlange"}</span>
      <h3>${escapeHtml(selected.name || entry.serviceNumber)}</h3>
      ${serviceNumbers ? `<span class="service-number-meta">${escapeHtml(serviceNumbers)}</span>` : ""}
      <p>${(entry.members || []).length} Mitglied${(entry.members || []).length === 1 ? "" : "er"}</p>
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
          <strong>${selectedKind === "skill" ? "Skill-Stufen" : "Prioritäten"}</strong>
          <span class="service-priority-help">${selectedKind === "skill" ? "Höhere Zahl = stärkerer Skill-Fokus." : "0 wird zuerst gerufen. Höhere Zahlen werden nachrangiger genutzt."}</span>
        </div>
      ` : ""}
      ${(entry.members || []).map((member) => `
        <label class="service-member-setting">
          <span>${escapeHtml(member.name || "Nebenstelle")} (${escapeHtml(member.extensionNumber)})</span>
          ${selectedKind === "skill" ? `
            <input type="number" min="1" max="9" value="${escapeHtml(member.skillLevel || 1)}" data-update-service-member data-field="skillLevel" data-service-kind="${escapeHtml(selectedKind)}" data-service-id="${escapeHtml(entry.serviceNumber)}" data-extension-number="${escapeHtml(member.extensionNumber)}">
          ` : `
            <input type="number" min="0" max="99" value="${escapeHtml(member.penalty || 0)}" data-update-service-member data-field="penalty" data-service-kind="${escapeHtml(selectedKind)}" data-service-id="${escapeHtml(entry.serviceNumber)}" data-extension-number="${escapeHtml(member.extensionNumber)}">
          `}
        </label>
      `).join("") || `<div class="empty-state">Noch keine Mitglieder im Entwurf.</div>`}
    </div>
  `;
}

function renderEndpoints() {
  const endpoints = getOverview()?.endpoints || {};
  const overview = getOverview() || {};
  const endpointDetails = {
    version: { label: "API-Version", purpose: "Basischeck: Portal API erreichbar.", required: false },
    basicData: { label: "Kundendaten", purpose: "Account- und Mandanteninfo für Status und Diagnose.", required: false },
    contract: { label: "Vertrag", purpose: "Zusatzinfo zum Kundenvertrag, nicht workflowkritisch.", required: false },
    featureStatus: { label: "Features", purpose: "Optionale Lizenz-/Feature-Info. Ein 403 blockiert die Workflows nicht.", required: false },
    extensions: { label: "Nebenstellen", purpose: "Bestand für Nebenstellenliste, Batch Import und Zielauswahl.", required: true },
    devices: { label: "Geräte", purpose: "Gerätebezug zu Nebenstellen und Inventar.", required: true },
    trunks: { label: "Leitungen", purpose: "SIP-Trunk-Bestand für eingehende Rufnummern.", required: true },
    dids: { label: "Rufnummern", purpose: "DID-Routing für Callflow und Tag/Nacht-Zeitsteuerungen.", required: true },
    phoneBooks: { label: "Telefonbücher", purpose: "Bestand und Schreibziel für Telefonbuch-Sync.", required: true },
    groups: { label: "Teams", purpose: "Gruppen-Ziele für Routing und Callflow.", required: true },
    queues: { label: "Warteschlangen", purpose: "Warteschlangen-Ziele und Mitgliederverwaltung.", required: true },
    skills: { label: "Skillgruppen", purpose: "Skill-Ziele und Skill-Level-Verwaltung.", required: true },
    ivrs: { label: "Sprachdialoge", purpose: "Sprachdialog-Ziele, auch für Ansage-Ziel mit Folgeaktion.", required: true },
    timeControls: { label: "Zeitsteuerungen", purpose: "Tag/Nacht-Zeitsteuerungen und Öffnungszeit-Routing.", required: true },
    announcements: { label: "Ansagen", purpose: "Vorhandene Audioansagen für Ansage-Ziele.", required: true },
  };

  if (!Object.keys(endpoints).length) {
    $("#endpoint-status").innerHTML = `<div class="empty-state">Demo-Daten aktiv.</div>`;
    return;
  }

  $("#endpoint-status").classList.toggle("is-collapsed", !state.technicalOpen);
  $("#toggle-technical").textContent = state.technicalOpen ? "Details ausblenden" : "Details anzeigen";
  $("#endpoint-status").innerHTML = Object.entries(endpointDetails).map(([key, detail]) => {
    const endpoint = endpoints[key];
    if (!endpoint) return "";
    const isOptional = !detail.required || OPTIONAL_ENDPOINT_KEYS.has(key);
    const statusLabel = endpoint.ok
      ? "OK"
      : isOptional
        ? "Optional"
        : "Fehler";
    const countText = endpoint.ok
      ? (Number(endpoint.count) === 1 ? "1 Datensatz geladen" : `${endpoint.count ?? 0} Datensätze geladen`)
      : (isOptional ? "Optionaler Endpoint nicht verfügbar" : "Pflicht-Endpunkt nicht verfügbar");
    const path = endpoint.path || "";
    const errorText = endpoint.ok ? "" : endpoint.error || "Keine Detailmeldung verfügbar.";
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
        ["Kunde", customer.name || "unbekannt"],
        ["Account", account || "nach Login sichtbar"],
        ["Snom Transfer", customer.snomTransfer || "unbekannt"],
      ];
    case "contract":
      return contractRows.length ? contractRows : [["Vertrag", "Keine freigegebenen Vertragsfelder geliefert"]];
    case "featureStatus":
      return [["Status", "Kein Zugriff auf Feature-Details"]];
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
  if (value === true) return "Ja";
  if (value === false) return "Nein";
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
    railButton.title = "Menü ausblenden";
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
    dids: "Rufnummern",
    extensions: "Nebenstellen",
    queues: "Warteschlangen",
    ivrs: "Sprachdialoge",
    skills: "Skillgruppen",
    timeControls: "Zeitsteuerung",
    menus: "Sprachdialoge",
  }[menu] || "Callflow";
}

function setView(view) {
  if (!VIEW_IDS.has(view)) return;
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
  if (!node) return;
  node[field] = value;
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
  if (!node) return;
  node[field] = value;
  if (field === "subtitle") node.targetNumber = targetNumberFromText(value);
  syncBranchSourceConfig(node);
  if (state.flow) materializeBranchNodes(state.flow);
  saveCurrentFlowLayout();
  saveCurrentFlowDraft(false);
  state.flowFeedback = null;
  renderCallflow();
  renderFlowFeedback();
}

function applyNodeTypeDefaults(node, type) {
  const kind = normalizeTargetType(type);
  node.type = kind;
  node.tone = targetTone(kind);
  node.config = {};
  if (!node.title || node.title === "Neuer Schritt" || node.missing) {
    const titles = {
      TIMECONTROL: "Geschäftszeiten",
      IVR: "Sprachdialog",
      ANNOUNCEMENT: "Ansage",
      HANGUP: "Auflegen",
      QUEUE: "Warteschlange",
      GROUP: "Skillgruppe",
      SKILL: "Skillgruppe",
      VOICEMAIL: "Anrufbeantworter",
      PHONEEXTENSION: "Nebenstelle",
      FRONTDESK: "Frontdesk",
      PLACEHOLDER: "Neuer Schritt",
    };
    node.title = titles[kind] || "Neuer Schritt";
  }
  if (kind === "PLACEHOLDER") node.subtitle = "Art wählen";
  if (kind === "TIMECONTROL") node.subtitle = "Zeitfenster festlegen";
  if (kind === "IVR") node.subtitle = "Tasten konfigurieren";
  if (kind === "ANNOUNCEMENT") node.subtitle = "Ansage wählen";
  if (kind === "HANGUP") node.subtitle = "Anruf beenden";
  if (["QUEUE", "GROUP", "SKILL", "IVR", "TIMECONTROL"].includes(kind)) {
    node.config.portalMode = "new";
  }
  if (kind === "IVR") node.config.ivrKeys = ["1", "2"];
  if (kind === "TIMECONTROL") node.config.hours = "Mo-Fr 08:00-17:00";
  node.missing = kind === "PLACEHOLDER";
  ensureNodeConfig(node);
}

function updateNodeConfig(field, value) {
  const node = selectedNode();
  if (!node) return;
  ensureNodeConfig(node);
  if (field === "portalMode") {
    node.config.portalMode = value;
    if (value === "new") {
      delete node.routeNumber;
      delete node.targetNumber;
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
    materializeBranchNodes(state.flow);
    saveCurrentFlowDraft(false);
    state.flowFeedback = null;
    renderCallflow();
    renderFlowHelper();
    renderFlowFeedback();
    return;
  }
  node.config[field] = value;
  if (normalizeTargetType(node.type) === "TIMECONTROL" && field === "hours") node.subtitle = value;
  if (["announcement"].includes(field) && value) node.subtitle = value;
  if (state.flow) materializeBranchNodes(state.flow);
  syncBranchSourceConfig(node);
  saveCurrentFlowDraft(false);
  state.flowFeedback = null;
  renderCallflow();
  renderFlowHelper();
  renderFlowFeedback();
}

function updateNodeConfigWithoutHelperRender(field, value) {
  const node = selectedNode();
  if (!node) return;
  ensureNodeConfig(node);
  if (field === "portalMode") return;
  node.config[field] = value;
  if (normalizeTargetType(node.type) === "TIMECONTROL" && field === "hours") node.subtitle = value;
  if (["announcement"].includes(field) && value) node.subtitle = value;
  if (state.flow) materializeBranchNodes(state.flow);
  syncBranchSourceConfig(node);
  saveCurrentFlowDraft(false);
  state.flowFeedback = null;
  renderCallflow();
  renderFlowFeedback();
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
    const ivrKey = ivrKeyFromField(field);
    if (normalizeTargetType(node.type) === "IVR" && ivrKey) {
      removeIvrKey(node, ivrKey);
    } else {
      delete node.config[field];
      removeBranch(state.flow, node, field);
    }
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
  node.config[field] = target;
  const ivrKey = ivrKeyFromField(field);
  if (normalizeTargetType(node.type) === "IVR" && ivrKey) {
    node.config.ivrKeys = [...new Set([...ivrKeyNumbers(node), ivrKey])];
    node.config.ivrKeysVerified = true;
  }
  materializeBranchNodes(state.flow);
  const branchNode = branchTargetNode(node, field);
  if (branchNode) applyTargetToNode(branchNode, target);
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
  node.config.ivrKeys = [...new Set([...ivrKeyNumbers(node), key])];
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
  const target = nodes.find((node) => node.id === (exactEdge?.to || ""));
  const id = `local-${Date.now()}`;
  const x = exactEdge && target
    ? clamp(((Number(selected.x) || 20) + (Number(target.x) || 60)) / 2, 2, 82)
    : Math.min((Number(selected.x) || 20) + 16, 82);
  const y = exactEdge && target
    ? clamp(((Number(selected.y) || 35) + (Number(target.y) || 50)) / 2, 4, 78)
    : Math.min((Number(selected.y) || 35) + 14, 78);
  const position = safeFlowPosition(x, y);
  const next = {
    id,
    type: "PLACEHOLDER",
    title: "Neuer Schritt",
    subtitle: "Art wählen",
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
        markBranchTarget(next, source, branchSpec(exactEdge.branchField, exactEdge.label || "danach", "Neuer Schritt", "Art wählen", 0, 0));
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
  const id = `local-${Date.now()}`;
  const node = {
    id,
    type: normalizeTargetType(target.type || "PLACEHOLDER"),
    title: target.title || "Neuer Schritt",
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
  Object.assign(node, safeFlowPosition((point.x / FLOW_WORLD_WIDTH) * 100, (point.y / FLOW_POSITION_HEIGHT) * 100));
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
    title: target.title || `Nebenstelle ${number}`,
    subtitle: `Nebenstelle ${number}`,
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
  render();
  return true;
}

function assignExtensionToBranchSource(source, target) {
  const branchField = firstAvailableBranchField(source);
  if (!branchField) return false;
  ensureNodeConfig(source);
  source.config[branchField] = targetFromFlowNode(target);
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
    render();
    return true;
  }
  if (targetNode.branchTarget) {
    applyTargetToNode(targetNode, extensionTarget);
    syncBranchSourceConfig(targetNode);
    finalizeFlowMutation();
    return true;
  }
  if (["IVR", "TIMECONTROL", "ANNOUNCEMENT"].includes(kind)) {
    return assignExtensionToBranchSource(targetNode, extensionTarget);
  }
  addPaletteNodeToCanvas(extensionTarget, point || { x: nodeWorldBox(targetNode).centerX + 260, y: nodeWorldBox(targetNode).centerY });
  connectFlowNodes(targetNode.id, state.selectedNodeId);
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

function connectFlowNodes(fromId, toId) {
  if (!state.flow || !fromId || !toId || fromId === toId) return;
  const first = (state.flow.nodes || []).find((node) => node.id === fromId) || visibleFlowNodeById(fromId);
  const second = (state.flow.nodes || []).find((node) => node.id === toId) || visibleFlowNodeById(toId);
  if (!first || !second || first.locked && second.locked) return;
  if (applyServiceMembershipConnection(first, second)) return;
  if (first.virtual || second.virtual) return;
  const { source, target } = resolveLogicalConnection(first, second);
  clearPairConnections(state.flow, source.id, target.id);
  const branchField = firstAvailableBranchField(source);
  if (branchField) {
    ensureNodeConfig(source);
    source.config[branchField] = targetFromFlowNode(target);
    const label = branchField === "openTarget"
      ? "innerhalb"
      : branchField === "closedTarget"
        ? "außerhalb"
        : ivrKeyFromField(branchField)
          ? `Taste ${ivrKeyFromField(branchField)}`
          : branchField === "afterTarget"
            ? "danach"
            : "führt zu";
    state.flow.edges = (state.flow.edges || []).filter((edge) => !(edge.from === source.id && edge.branchField === branchField));
    state.flow.edges.push({ from: source.id, to: target.id, label, branchField });
    markBranchTarget(target, source, branchSpec(branchField, label, target.title, target.subtitle, 0, 0, targetFromFlowNode(target)));
  } else {
    state.flow.edges.push({ from: source.id, to: target.id, label: "führt zu" });
  }
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
  render();
  return true;
}

function stageFlowPlan(options = {}) {
  const did = selectedDid();
  const target = (state.flow?.nodes || []).find((node) => node.isTarget) || selectedNode();
  const before = `${did?.name || "-"} → ${did?.value || "kein Ziel"}`;
  const after = `${did?.name || "-"} → ${currentDraftTarget()}`;
  const validation = validateFlowDetails();
  saveCurrentFlowDraft(false);
  state.actionPlan = {
    ok: validation.ok,
    context: "callflow",
    dryRun: true,
    title: validation.ok
      ? validation.liveCapable
        ? (validation.complex ? "Komplexer Callflow geprüft" : "Direktänderung geprüft")
        : "Entwurf lokal gespeichert"
      : "Callflow unvollständig",
    message: validation.ok
      ? (validation.liveCapable
        ? (validation.complex
          ? "Der Flow kann als Portal-Zielobjekte angelegt und auf die Rufnummer geroutet werden."
          : "Der direkte Zielwechsel kann live übernommen werden.")
        : "Der Flow ist lokal gespeichert.")
      : `Fehlt: ${validation.problems.join(" · ")}`,
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
  stageFlowPlan({ silent: true });
  const plan = state.actionPlan;
  if (plan) plan.directApply = true;
  if (!plan?.applyPayload || plan.ok === false) {
    if (plan) plan.applyAttempted = true;
    showUiNotice({
      title: plan?.title || "Callflow nicht übernommen",
      message: plan?.message || "Der Callflow kann nicht live übernommen werden.",
      type: plan?.ok === false ? "error" : "warning",
    });
    renderFlowFeedback();
    renderFlowPlan();
    return;
  }
  if (!liveWritesEnabled()) {
    plan.applyAttempted = true;
    showUiNotice({ title: "Live-Schreiben deaktiviert", message: liveWritesDisabledText(), type: "warning" });
    renderFlowFeedback();
    renderFlowPlan();
    return;
  }
  await applyFlowPlan();
}

function deleteSelectedNode() {
  const node = selectedNode();
  if (!state.flow || !node || node.locked) return;
  if (node.memberNode) {
    removeServiceMemberFlowNode(node);
    return;
  }
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
      label: incoming.branchField ? incoming.label : outgoing.label || incoming.label || "führt zu",
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
  const result = await fetchJson(endpoint, {
    method: "POST",
    body: JSON.stringify({ ...formPayload(form), ...extra }),
  });
  state.actionPlan = { ...result, context: targetView };
  setView(targetView);
  renderActionPlan();
}

async function stagePhonebookSync() {
  state.phonebookSyncLoading = true;
  const hasManualContacts = collectManualPhonebookRows().length > 0;
  state.actionPlan = {
    ok: true,
    type: "phonebook-sync",
    title: "Abgleich wird vorbereitet",
    message: hasManualContacts
      ? "Manuelle Kontakte werden als lokale Quelle gesetzt und mit dem NFON-Telefonbuch verglichen."
      : "Kontaktquelle und NFON-Telefonbuch werden verglichen. Es wird nichts gespeichert.",
    source: {},
    target: {},
    summary: {},
    actions: [],
    createdAt: new Date().toISOString(),
  };
  renderPhonebookSync();
  renderActionPlan();

  try {
    if (hasManualContacts) await persistManualPhonebookContacts();
    state.actionPlan = await fetchJson("/api/phonebook-sync/preview", { method: "POST" });
  } catch (error) {
    state.actionPlan = {
      ok: false,
      type: "phonebook-sync",
      title: "Telefonbuch-Sync fehlgeschlagen",
      message: error.message,
      source: {},
      target: {},
      summary: {},
      actions: [],
      createdAt: new Date().toISOString(),
    };
  } finally {
    state.phonebookSyncLoading = false;
    renderPhonebookSync();
    renderActionPlan();
  }
}

async function applyPhonebookSync() {
  if (state.actionPlan?.type !== "phonebook-sync") return;
  state.phonebookSyncLoading = true;
  state.actionPlan = {
    ...state.actionPlan,
    ok: true,
    title: "Änderungen werden übernommen",
    message: "Portal API speichert die ermittelten Telefonbuch-Änderungen.",
  };
  renderPhonebookSync();
  renderActionPlan();

  try {
    const result = await fetchJson("/api/phonebook-sync/apply", { method: "POST" });
    state.actionPlan = result;
    await loadOverview();
    state.actionPlan = result;
  } catch (error) {
    state.actionPlan = {
      ...state.actionPlan,
      ok: false,
      type: "phonebook-sync",
      title: "Übernahme fehlgeschlagen",
      message: error.message,
      applied: false,
      createdAt: new Date().toISOString(),
    };
  } finally {
    state.phonebookSyncLoading = false;
    renderPhonebookSync();
    renderActionPlan();
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
  state.extensionBatchPlan = null;
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
  state.extensionBatchPlan = null;
}

function focusExtensionBatchRow(index) {
  window.requestAnimationFrame(() => {
    const input = document.querySelector(`[data-extension-batch-row="${index}"] [data-extension-batch-field="extensionNumber"]`);
    input?.focus();
  });
}

function addExtensionBatchRow() {
  state.extensionBatchRows.push(emptyExtensionBatchRow());
  state.extensionBatchPlan = null;
  renderExtensionBatch();
  focusExtensionBatchRow(state.extensionBatchRows.length - 1);
}

function insertExtensionBatchRowAfter(index) {
  const nextIndex = Math.min(Math.max(Number(index) + 1, 0), state.extensionBatchRows.length);
  state.extensionBatchRows.splice(nextIndex, 0, emptyExtensionBatchRow());
  state.extensionBatchPlan = null;
  renderExtensionBatch();
  focusExtensionBatchRow(nextIndex);
}

function removeExtensionBatchRow(index) {
  state.extensionBatchRows.splice(index, 1);
  if (!state.extensionBatchRows.length) addExtensionBatchRow();
  state.extensionBatchPlan = null;
  renderExtensionBatch();
}

async function loadExtensionBatchCsv(file) {
  if (!file) return;
  try {
    const rows = parseExtensionBatchCsv(await file.text());
    state.extensionBatchRows = rows.length ? rows : state.extensionBatchRows;
    state.extensionBatchPlan = rows.length ? null : {
      ok: false,
      title: "CSV leer",
      message: "Die Datei enthält keine verwertbaren Nebenstellen.",
      summary: { total: 0, valid: 0, invalid: 0, existing: 0 },
      entries: [],
    };
  } catch (error) {
    state.extensionBatchPlan = {
      ok: false,
      title: "CSV nicht gelesen",
      message: error.message,
      summary: { total: 0, valid: 0, invalid: 0, existing: 0 },
      entries: [],
    };
  }
  renderExtensionBatch();
}

async function planExtensionBatch() {
  state.extensionBatchLoading = true;
  state.extensionBatchPlan = {
    ok: false,
    title: "Batch wird geprüft",
    message: "Die Liste wird gegen den aktuellen Nebenstellenbestand geprüft.",
    summary: { total: extensionBatchRows().length, valid: 0, invalid: 0, existing: 0 },
    entries: [],
  };
  renderExtensionBatch();
  try {
    state.extensionBatchPlan = await fetchJson("/api/extensions/batch/plan", {
      method: "POST",
      body: JSON.stringify({ rows: extensionBatchRows() }),
    });
  } catch (error) {
    state.extensionBatchPlan = {
      ok: false,
      title: "Batch-Prüfung fehlgeschlagen",
      message: error.message,
      summary: { total: extensionBatchRows().length, valid: 0, invalid: 0, existing: 0 },
      entries: [],
    };
  } finally {
    state.extensionBatchLoading = false;
    renderExtensionBatch();
  }
}

async function applyExtensionBatch() {
  if (!state.extensionBatchPlan?.ok || !liveWritesEnabled()) return;
  const confirmed = await confirmUi({
    title: "Batch Import übernehmen",
    message: "Diese Nebenstellen werden live in der Portal API angelegt. Fortfahren?",
    confirmLabel: "Übernehmen",
  });
  if (!confirmed) return;
  const progress = showUiProgress({ title: "Batch Import wird übernommen", message: "Portal API legt die Nebenstellen an." });
  state.extensionBatchLoading = true;
  renderExtensionBatch();
  try {
    const result = await fetchJson("/api/extensions/batch/apply", {
      method: "POST",
      body: JSON.stringify({ rows: extensionBatchRows() }),
    });
    state.extensionBatchPlan = result;
    await loadOverview();
    state.extensionBatchPlan = result;
    progress.success({ title: "Batch Import übernommen", message: result.message || "Die Nebenstellen wurden verarbeitet." });
  } catch (error) {
    state.extensionBatchPlan = {
      ...state.extensionBatchPlan,
      ok: false,
      applied: false,
      title: "Batch-Übernahme fehlgeschlagen",
      message: error.message,
    };
    progress.error({ title: "Batch-Übernahme fehlgeschlagen", message: error.message });
  } finally {
    state.extensionBatchLoading = false;
    render();
  }
}

async function uploadPhonebookContacts(form) {
  const file = form.querySelector("#phonebook-upload-file")?.files?.[0];
  if (!file) {
    state.phonebookUploadFeedback = { ok: false, title: "Upload fehlt", message: "Bitte zuerst eine JSON- oder CSV-Datei auswählen." };
    renderPhonebookSync();
    return;
  }
  try {
    const text = await file.text();
    let contacts;
    if (file.name.toLowerCase().endsWith(".csv")) {
      contacts = contactsFromCsv(text);
    } else {
      const parsed = JSON.parse(text);
      contacts = Array.isArray(parsed) ? parsed : parsed.contacts;
    }
    const result = await fetchJson("/api/phonebook-sync/upload", {
      method: "POST",
      body: JSON.stringify({ contacts, source: file.name, syncedAt: new Date(file.lastModified || Date.now()).toISOString() }),
    });
    if (state.overview) state.overview.settings = result.settings;
    state.phonebookManualRows = [];
    state.phonebookManualDraft = { firstName: "", name: "", phone: "" };
    state.phonebookManualDirty = false;
    state.phonebookUploadFeedback = {
      ok: true,
      title: "Upload übernommen",
      message: `${result.contacts} Kontakt${result.contacts === 1 ? "" : "e"} sind als Kontaktquelle aktiv.`,
    };
    await stagePhonebookSync();
  } catch (error) {
    state.phonebookUploadFeedback = { ok: false, title: "Upload fehlgeschlagen", message: error.message };
    renderPhonebookSync();
  }
}

function selectedProfileTarget(choices = parsedDaynightTargetOptions()) {
  const selected = choices.find(({ option }) => option.value === state.profileTargetValue) || choices[0];
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
  const snapshot = buildProfileSnapshot("Standard");
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
    title: "Standard-Profil gesichert",
    message: `${snapshot.dids.length} Rufnummer${snapshot.dids.length === 1 ? "" : "n"} als Wiederherstellungspunkt gespeichert und als JSON heruntergeladen.`,
    profileName: "Standard",
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
      throw new Error("Die Datei ist kein Standardprofil-Backup dieser App.");
    }
    if (!profile || !Array.isArray(profile.dids) || !profile.createdAt) {
      throw new Error("Das Backup enthaelt kein gueltiges Standardprofil.");
    }
    if (payloadAccount && payloadAccount !== currentAccount) {
      throw new Error(`Das Backup gehoert zu ${payloadAccount}, aktiv ist ${currentAccount}.`);
    }
    writeProfile("standard", {
      ...profile,
      name: profile.name || "Standard",
      account: currentAccount,
    });
    state.actionPlan = {
      ok: true,
      type: "profile",
      context: targetView,
      title: "Standard-Backup geladen",
      message: `${profile.dids.length} Rufnummer${profile.dids.length === 1 ? "" : "n"} aus ${file.name} geladen. Der Wiederherstellungsplan wird jetzt geprueft.`,
      profileName: "Standard",
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
      title: "Standard-Backup nicht geladen",
      message: error.message,
      profileName: "Standard",
      changeCount: 0,
      changes: [],
      createdAt: new Date().toISOString(),
    };
    presentActionPlan(targetView);
  }
}

async function stageProfilePlan(profileName, changes, emptyMessage, targetView = "changes") {
  if (!changes.length) {
    state.actionPlan = {
      ok: true,
      type: "profile",
      context: targetView,
      title: "Keine Änderung nötig",
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
    title: `${profileName} wird geprüft`,
    message: "Portal API baut die technische Vorschau.",
    profileName,
    changeCount: changes.length,
    changes: [],
    createdAt: new Date().toISOString(),
  };
  presentActionPlan(targetView);

  try {
    const result = await fetchJson("/api/callflow/bulk-apply", {
      method: "POST",
      body: JSON.stringify({ profileName, changes, commit: false }),
    });
    state.actionPlan = { ...result, context: targetView };
  } catch (error) {
    state.actionPlan = {
      ok: false,
      type: "profile",
      context: targetView,
      title: "Profil-Prüfung fehlgeschlagen",
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
      title: "Kein Nachtziel verfügbar",
      message: "Es wurde kein vorhandenes Portal-Ziel gefunden.",
      profileName: "Nachtmodus",
      changeCount: 0,
      changes: [],
      createdAt: new Date().toISOString(),
    };
    presentActionPlan(targetView);
    return;
  }

  await stageProfilePlan(
    "Nachtmodus",
    buildChangesToTarget(target),
    "Alle Rufnummern führen bereits zum gewählten Nachtziel.",
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
      title: "Kein Standard-Profil",
      message: "Speichere zuerst den aktuellen Standard.",
      profileName: "Standard",
      changeCount: 0,
      changes: [],
      createdAt: new Date().toISOString(),
    };
    presentActionPlan(targetView);
    return;
  }

  await stageProfilePlan(
    "Standard",
    buildChangesFromProfile(profile),
    "Das aktuelle Routing entspricht bereits dem gespeicherten Standard.",
    targetView,
  );
}

async function previewDaynightGateway(options = {}) {
  if (!options.preserveFeedback) {
    state.daynightOperationFeedback = null;
  }
  state.daynightGatewayLoading = true;
  state.daynightGatewayPreview = {
    readOnly: true,
    title: "Zeitsteuerungs-Plan wird geprüft",
    message: "Portal API wird nur gelesen. Es werden keine Änderungen geschrieben.",
    summary: { total: 0, ready: 0, blocked: 0, frontdesk: 0 },
    entries: [],
  };
  renderFlowProfileActions();
  renderDaynightGatewayPreview();
  try {
    state.daynightGatewayPreview = await fetchJson("/api/daynight/gateway-preview", {
      method: "POST",
      body: JSON.stringify({ nightTarget: selectedProfileTarget() }),
    });
  } catch (error) {
    state.daynightGatewayPreview = {
      ok: false,
      readOnly: true,
      title: "Zeitsteuerungs-Check fehlgeschlagen",
      message: error.message,
      summary: { total: 0, ready: 0, blocked: 0, frontdesk: 0 },
      entries: [],
      blockers: [error.message],
    };
  } finally {
    state.daynightGatewayLoading = false;
    renderFlowProfileActions();
    renderDaynightGatewayPreview();
  }
}

async function applyDaynightGateways() {
  if (!state.daynightGatewayPreview?.ok || state.daynightGatewayApplyLoading) return;
  if (!liveWritesEnabled()) {
    state.daynightGatewayPreview = {
      ...state.daynightGatewayPreview,
      ok: false,
      title: "Live-Schreiben deaktiviert",
      message: liveWritesDisabledText(),
    };
    renderDaynightGatewayPreview();
    return;
  }
  state.daynightGatewayApplyLoading = true;
  state.daynightGatewayPreview = {
    ...state.daynightGatewayPreview,
    title: "Zeitsteuerungen werden geschrieben",
    message: "Portal API legt fehlende Zeitsteuerungen an und aktualisiert vorhandene Zeitsteuerungen auf das Nachtziel. Rufnummern bleiben unverändert.",
  };
  renderDaynightGatewayPreview();
  try {
    const result = await fetchJson("/api/daynight/gateways/apply", {
      method: "POST",
      body: JSON.stringify({ nightTarget: selectedProfileTarget() }),
    });
    state.daynightGatewayPreview = result;
    setDaynightOperationFeedback(result, "Zeitsteuerungen geschrieben");
    await loadOverview();
    await previewDaynightGateway({ preserveFeedback: true });
  } catch (error) {
    await refreshDaynightAfterLiveError(error, "Zeitsteuerungs-Anlage fehlgeschlagen");
  } finally {
    state.daynightGatewayApplyLoading = false;
    renderFlowProfileActions();
    renderDaynightGatewayPreview();
  }
}

async function cleanupDaynightTimeControls() {
  if (!state.daynightGatewayPreview || state.daynightGatewayCleanupLoading) return;
  const count = state.daynightGatewayPreview?.summary?.cleanupCandidates || state.daynightGatewayPreview?.staleTimeControls?.length || 0;
  const managedGatewayCount = state.daynightGatewayPreview?.summary?.gatewaysExisting || 0;
  if (!count && managedGatewayCount > 0) {
    resetDaynightTimeControls();
    return;
  }
  if (!count) return;
  if (!liveWritesEnabled()) {
    state.daynightGatewayPreview = {
      ...state.daynightGatewayPreview,
      ok: false,
      title: "Live-Schreiben deaktiviert",
      message: liveWritesDisabledText(),
    };
    renderDaynightGatewayPreview();
    return;
  }
  state.daynightGatewayCleanupLoading = true;
  state.daynightGatewayPreview = {
    ...state.daynightGatewayPreview,
    title: "Zeitsteuerungen werden bereinigt",
    message: "Portal API löscht nur alte Nachtschaltungs-Zeitsteuerungen nach Namenskonvention.",
  };
  renderDaynightGatewayPreview();
  try {
    const result = await fetchJson("/api/daynight/time-controls/cleanup", {
      method: "POST",
      body: JSON.stringify({ nightTarget: selectedProfileTarget() }),
    });
    state.daynightGatewayPreview = result;
    setDaynightOperationFeedback(result, "Zeitsteuerungen bereinigt");
    await loadOverview();
    await previewDaynightGateway({ preserveFeedback: true });
  } catch (error) {
    await refreshDaynightAfterLiveError(error, "Cleanup fehlgeschlagen");
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
  if (!portalLiveWritesEnabled()) {
    state.daynightGatewayPreview = {
      ...state.daynightGatewayPreview,
      ok: false,
      title: "Live-Schreiben deaktiviert",
      message: liveWritesDisabledText(),
    };
    renderDaynightGatewayPreview();
    return false;
  }
  state.daynightGatewayResetLoading = true;
  state.daynightGatewayPreview = {
    ...state.daynightGatewayPreview,
    title: "Nachtschaltung wird zurückgesetzt",
    message: "Portal API stellt betroffene Rufnummern zurück und löscht danach die verwalteten TN-Zeitsteuerungen.",
  };
  renderDaynightGatewayPreview();
  try {
    const result = await fetchJson("/api/daynight/reset", { method: "POST", body: JSON.stringify({}) });
    state.daynightGatewayPreview = result;
    setDaynightOperationFeedback(result, "Nachtschaltung zurückgesetzt");
    if (options.fromHeaderSwitch || state.daynightActive) {
      setDaynightActive(false, "day");
    }
    await loadOverview();
    await previewDaynightGateway({ preserveFeedback: true });
    return true;
  } catch (error) {
    await refreshDaynightAfterLiveError(error, "Reset fehlgeschlagen");
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
  if (!portalLiveWritesEnabled()) {
    state.daynightModeModal = {
      mode: "error",
      title: "Live-Schreiben deaktiviert",
      message: liveWritesDisabledText(),
    };
    renderDaynightModeModal();
    return false;
  }
  state.daynightGatewayResetLoading = true;
  state.daynightModeSwitchLoading = true;
  state.daynightModeModal = {
    mode: "loading",
    title: "Bitte warten",
    message: "Der Tagmodus wird wiederhergestellt. Die vorbereiteten Zeitsteuerungen bleiben erhalten.",
    busy: true,
  };
  renderDaynightModeModal();
  updateDaynightHeaderButton();
  try {
    const result = await fetchJson("/api/daynight/restore", { method: "POST", body: JSON.stringify({}) });
    state.daynightGatewayPreview = result;
    setDaynightOperationFeedback(result, "Tagmodus aktiviert");
    if (result.ok !== false) {
      state.daynightActive = false;
      localStorage.setItem(DAYNIGHT_ACTIVE_STORAGE_KEY, "0");
      state.daynightModeModal = "day";
    }
    await loadOverview();
    await previewDaynightGateway({ preserveFeedback: true });
    return result.ok !== false;
  } catch (error) {
    await refreshDaynightAfterLiveError(error, "Tagmodus fehlgeschlagen");
    state.daynightModeModal = {
      mode: "error",
      message: error.message || "Der Tagmodus konnte nicht wiederhergestellt werden.",
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
  if (!portalLiveWritesEnabled()) {
    state.daynightGatewayPreview = {
      ...state.daynightGatewayPreview,
      ok: false,
      title: "Live-Schreiben deaktiviert",
      message: liveWritesDisabledText(),
    };
    renderDaynightGatewayPreview();
    return false;
  }
  state.daynightGatewayRoutingLoading = true;
  if (options.fromHeaderSwitch) {
    state.daynightModeSwitchLoading = true;
    state.daynightModeModal = {
      mode: "loading",
      title: "Bitte warten",
      message: "Der Nachtmodus wird aktiviert. Die Portal API hängt Rufnummern auf die vorbereiteten Zeitsteuerungen.",
      busy: true,
    };
    renderDaynightModeModal();
    updateDaynightHeaderButton();
  }
  state.daynightGatewayPreview = {
    ...state.daynightGatewayPreview,
    title: "Rufnummern werden umgehängt",
    message: "Portal API entfernt die bisherigen DID-Zuordnungen und hängt sie an die vorbereiteten Zeitsteuerungen. Bei Fehlern wird ein Rollback versucht.",
  };
  renderDaynightGatewayPreview();
  try {
    const result = await fetchJson("/api/daynight/gateway-routing/apply", {
      method: "POST",
      body: JSON.stringify({ nightTarget: selectedProfileTarget() }),
    });
    state.daynightGatewayPreview = result;
    setDaynightOperationFeedback(result, "Rufnummern umgehängt");
    if (result.ok !== false) {
      setDaynightActive(true, "night");
    }
    await loadOverview();
    return result.ok !== false;
  } catch (error) {
    await refreshDaynightAfterLiveError(error, "Rufnummern-Migration fehlgeschlagen");
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

async function toggleDaynightMode(nextActive) {
  if (state.daynightModeSwitchLoading) return;
  if (nextActive === state.daynightActive) {
    updateDaynightHeaderButton();
    return;
  }
  if (!portalLiveWritesEnabled()) {
    state.daynightModeModal = {
      mode: "setup",
      title: "Live-Schreiben deaktiviert",
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
        title: "Bitte warten",
        message: "Ich prüfe, ob die Nachtschaltung vollständig vorbereitet ist.",
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
        message: "Die Nachtschaltung ist noch nicht vollständig vorbereitet. Bitte in Setup Standard sichern und den Zeitsteuerungs-Plan abschließen.",
      };
      renderDaynightModeModal();
      updateDaynightHeaderButton();
      return;
    }
    state.daynightModeModal = {
      mode: "confirm-night",
      symbol: "N",
      title: "Nachtmodus aktivieren?",
      message: "Rufnummern werden auf die vorbereiteten Zeitsteuerungen umgehängt. Danach sind Live-Änderungen in der App gesperrt.",
      actions: [
        { action: "close", label: "Abbrechen" },
        { action: "activate-night", label: "Nachtmodus aktivieren", kind: "primary" },
      ],
    };
    renderDaynightModeModal();
  } else {
    state.daynightModeModal = {
      mode: "confirm-day",
      symbol: "T",
      title: "Tagmodus aktivieren?",
      message: "Rufnummern werden auf die gespeicherten Tagesziele zurückgestellt. Die vorbereiteten Zeitsteuerungen bleiben für den nächsten Nachtmodus erhalten.",
      actions: [
        { action: "close", label: "Abbrechen" },
        { action: "activate-day", label: "Tagmodus aktivieren", kind: "primary" },
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
    displayName: state.daynightAnnouncementDisplayName || `Nachtansage ${state.daynightAnnouncementName || selectedAnnouncementName()}`,
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
      title: "Ansage-Ziel nicht prüfbar",
      message: error.message,
      blockers: [error.message],
    };
  } finally {
    state.daynightAnnouncementLoading = false;
    renderDaynightGatewayPreview();
  }
}

async function applyDaynightAnnouncementTarget() {
  if (!liveWritesEnabled()) return;
  const payload = daynightAnnouncementPayload();
  const confirmed = await confirmUi({
    title: "Ansage-Ziel anlegen",
    message: `Ansage-Ziel "${payload.displayName}" live als Sprachdialog anlegen? Rufnummern und Zeitsteuerungen werden dabei nicht verändert.`,
    confirmLabel: "Anlegen",
  });
  if (!confirmed) return;
  const progress = showUiProgress({ title: "Ansage-Ziel wird angelegt", message: "Portal API erstellt den Sprachdialog." });
  state.daynightAnnouncementLoading = true;
  renderDaynightGatewayPreview();
  try {
    const result = await fetchJson("/api/daynight/announcement-target/apply", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (result.option?.value) {
      state.profileTargetValue = result.option.value;
      state.daynightGatewayPreview = null;
      state.daynightUseAnnouncement = false;
    }
    await loadOverview();
    progress.success({ title: "Ansage-Ziel angelegt", message: "Das neue Nachtziel wurde live erstellt." });
  } catch (error) {
    state.daynightGatewayPreview = {
      ...(state.daynightGatewayPreview || {}),
      ok: false,
      title: "Ansage-Ziel nicht angelegt",
      message: error.message,
      blockers: [error.message],
    };
    progress.error({ title: "Ansage-Ziel nicht angelegt", message: error.message });
  } finally {
    state.daynightAnnouncementLoading = false;
    renderFlowProfileActions();
    renderDaynightGatewayPreview();
  }
}

async function applyFlowPlan() {
  if (!state.actionPlan?.applyPayload) return;
  state.actionPlan.applyAttempted = true;
  if (!liveWritesEnabled()) {
    const context = state.actionPlan.context || state.view;
    state.actionPlan = {
      ...state.actionPlan,
      ok: false,
      blocked: true,
      title: "Live-Schreiben deaktiviert",
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
  const confirmed = await confirmUi({
    title: "Callflow übernehmen",
    message: "Diese Änderung wird live an die Portal API gesendet. Fortfahren?",
    confirmLabel: "OK",
  });
  if (!confirmed) return;
  const progress = showUiProgress({ title: "Callflow wird übernommen", message: "Portal API schreibt die Änderung." });
  const context = state.actionPlan.context || state.view;
  const directApply = Boolean(state.actionPlan.directApply);
  const applyAttempted = Boolean(state.actionPlan.applyAttempted);
  const pendingFlow = clone(state.actionPlan.applyPayload?.flow || state.actionPlan.flow || state.flow || {});
  const pendingDid = selectedDid();

  try {
    state.actionPlan = {
      ...state.actionPlan,
      title: "Callflow wird übernommen",
      message: "Portal API schreibt die Änderung.",
      applyAttempted: true,
    };
    if (context === "callflow") {
      renderFlowFeedback();
      renderFlowPlan();
    } else {
      renderActionPlan();
    }

    const result = await fetchJson("/api/callflow/apply", {
      method: "POST",
      body: JSON.stringify({ ...state.actionPlan.applyPayload, commit: true }),
    });
    if (result.ok === false || result.applied === false) {
      state.actionPlan = { ...result, context, directApply, applyAttempted };
      if (context === "callflow") {
        state.flowFeedback = {
          ok: false,
          title: result.title || "Übernahme fehlgeschlagen",
          message: result.message || "Die Portal API hat die Änderung nicht angenommen.",
        };
        renderFlowFeedback();
        renderFlowPlan();
      } else {
        renderActionPlan();
      }
      progress.error({ title: result.title || "Übernahme fehlgeschlagen", message: result.message || "Die Portal API hat die Änderung nicht angenommen." });
      return;
    }
    saveAppliedFlowSnapshot(result.flow || pendingFlow, result, pendingDid);
    clearCurrentFlowDraft();
    state.actionPlan = { ...result, context, directApply, applyAttempted };
    await loadOverview();
    const expectedNoop = isExpectedNoopFlowResult(result);
    state.actionPlan = context === "callflow" && (expectedNoop || directApply) ? null : { ...result, context };
    if (context === "callflow") {
      state.view = "callflow";
      state.flowFeedback = expectedNoop ? null : {
        ok: result.ok !== false,
        title: "Callflow übernommen",
        message: result.message || "Die Änderung wurde an die Portal API gesendet.",
      };
      render();
    } else {
      setView("changes");
      renderActionPlan();
    }
    progress.success({ title: "Callflow übernommen", message: result.message || "Die Änderung wurde an die Portal API gesendet." });
  } catch (error) {
    state.actionPlan = {
      ...state.actionPlan,
      ok: false,
      context,
      title: "Übernahme fehlgeschlagen",
      message: error.message,
      applied: false,
    };
    if (context === "callflow") {
      renderFlowFeedback();
      renderFlowPlan();
    } else {
      renderActionPlan();
    }
    progress.error({ title: "Übernahme fehlgeschlagen", message: error.message });
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
  if (!liveWritesEnabled()) {
    const context = state.actionPlan.context || state.view;
    state.actionPlan = {
      ...state.actionPlan,
      ok: false,
      blocked: true,
      title: "Live-Schreiben deaktiviert",
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
    title: "Profil übernehmen",
    message: "Dieses Profil wird live auf mehrere Rufnummern angewendet. Fortfahren?",
    confirmLabel: "Übernehmen",
  });
  if (!confirmed) return;
  const progress = showUiProgress({ title: "Profil wird übernommen", message: "Portal API schreibt die Routing-Änderungen nacheinander." });
  const context = state.actionPlan.context || state.view;

  try {
    const pendingPlan = state.actionPlan;
    state.actionPlan = {
      ...state.actionPlan,
      title: `${pendingPlan.profileName || "Profil"} wird übernommen`,
      message: "Portal API schreibt die Routing-Änderungen nacheinander.",
    };
    if (context === "callflow") {
      renderFlowFeedback();
      renderFlowPlan();
    } else {
      renderActionPlan();
    }

    const result = await fetchJson("/api/callflow/bulk-apply", {
      method: "POST",
      body: JSON.stringify({ ...pendingPlan.applyPayload, commit: true }),
    });
    state.actionPlan = { ...result, context };
    await loadOverview();
    state.actionPlan = { ...result, context };
    if (context === "callflow") {
      state.view = "callflow";
      render();
    } else {
      setView("changes");
      renderActionPlan();
    }
    progress.success({ title: result.title || "Profil übernommen", message: result.message || "Die Änderungen wurden verarbeitet." });
  } catch (error) {
    state.actionPlan = {
      ...state.actionPlan,
      ok: false,
      context,
      title: "Profil-Übernahme fehlgeschlagen",
      message: error.message,
      applied: false,
    };
    if (context === "callflow") {
      renderFlowFeedback();
      renderFlowPlan();
    } else {
      renderActionPlan();
    }
    progress.error({ title: "Profil-Übernahme fehlgeschlagen", message: error.message });
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
    button.addEventListener("pointerup", navigate);
  });
}

document.addEventListener("click", (event) => {
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
    }
    return;
  }

  const didButton = event.target.closest("[data-did-id]");
  if (didButton) {
    state.selectedDidId = didButton.dataset.didId;
    const baseFlow = applyStoredFlowLayout(buildFlowForDid(selectedDid(), getOverview()), selectedDid());
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
    saveStandardProfile("callflow");
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
      restoreDaynightRouting({ fromHeaderSwitch: true });
      return;
    }
  }

  if (event.target.closest("[data-daynight-mode-close]")) {
    if (typeof state.daynightModeModal === "object" && state.daynightModeModal?.busy) return;
    closeDaynightModeModal();
    updateDaynightHeaderButton();
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

function exportFlowPdf() {
  const canvas = $("#callflow-canvas");
  const world = canvas?.querySelector(".flow-world");
  if (!canvas || !world) {
    window.print();
    return;
  }
  document.querySelector(".flow-print-export")?.remove();
  const contentBounds = flowPrintContentBounds(canvas);
  const pageWidthPx = 281 * 3.7795275591;
  const pageHeightPx = 194 * 3.7795275591;
  const scale = Math.min(
    pageWidthPx / Math.max(contentBounds.width, 1),
    pageHeightPx / Math.max(contentBounds.height, 1),
    1
  );
  const root = document.createElement("div");
  root.className = "flow-print-export";
  const stage = document.createElement("div");
  stage.className = "flow-print-stage";
  stage.style.width = `${Math.round(contentBounds.width * scale)}px`;
  stage.style.height = `${Math.round(contentBounds.height * scale)}px`;
  const viewport = document.createElement("div");
  viewport.className = "flow-print-viewport";
  viewport.style.width = `${Math.round(contentBounds.width)}px`;
  viewport.style.height = `${Math.round(contentBounds.height)}px`;
  viewport.style.transform = `scale(${scale})`;
  const clone = world.cloneNode(true);
  clone.style.position = "absolute";
  clone.style.left = `${-contentBounds.left}px`;
  clone.style.top = `${-contentBounds.top}px`;
  clone.style.margin = "0";
  clone.style.transform = "none";
  viewport.appendChild(clone);
  stage.appendChild(viewport);
  root.appendChild(stage);
  document.body.appendChild(root);
  document.body.classList.add("is-printing-flow");
  window.setTimeout(() => window.print(), 80);
}

function flowPrintContentBounds(canvas) {
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

window.addEventListener("afterprint", () => {
  document.body.classList.remove("is-printing-flow");
  document.querySelector(".flow-print-export")?.remove();
});

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
  if (event.key === "Escape" && uiDialog.open && !uiDialog.pending) {
    event.preventDefault();
    closeUiDialog(false);
    return;
  }

  const batchField = event.target?.dataset?.extensionBatchField;
  if (batchField && event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    const row = event.target.closest("[data-extension-batch-row]");
    insertExtensionBatchRowAfter(Number(row?.dataset.extensionBatchRow || 0));
    return;
  }

  if (state.view !== "callflow") return;
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
    renderFlowResourcePalette();
    renderView();
    return;
  }

  if (event.target.id === "demo-toggle") {
    state.demoMode = event.target.checked;
    const firstDid = getOverview()?.inventory?.dids?.[0];
    state.selectedDidId = firstDid?.id || "";
    const baseFlow = applyStoredFlowLayout(buildFlowForDid(selectedDid(), getOverview()), selectedDid());
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

document.addEventListener("change", (event) => {
  if (event.target.id === "daynight-mode-toggle") {
    const nextActive = event.target.checked;
    event.target.checked = state.daynightActive;
    toggleDaynightMode(nextActive);
    return;
  }

  if (event.target.id === "standard-flow-import-file") {
    importStandardProfileFile(event.target.files?.[0], "callflow");
    event.target.value = "";
    return;
  }

  if (event.target.id === "customer-switcher") {
    switchCustomer(event.target.value);
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
  if (nodeField) updateNodeField(nodeField, event.target.value);

  const configField = event.target.dataset.nodeConfigField;
  if (configField) updateNodeConfig(configField, event.target.value);

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

  if (event.target.id === "manual-customer-form") {
    event.preventDefault();
    const account = new FormData(event.target).get("account");
    switchCustomer(String(account || "").trim().toUpperCase());
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

bindStaticNavigation();
loadOverview();
loadCustomers();
