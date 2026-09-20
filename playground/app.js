import {
  answerAt,
  choiceQuestion,
  extractOptions,
  isGreeting,
  noulQuestion,
  renderChoice,
  renderMeta,
  renderYesNo,
  scoreQuestion,
  validateModelsResponse,
  validateSystemOneResponse,
  yesNoLike,
} from "./runtime.js";
import {
  isBrowserNetworkFailure,
  resolveRelayEndpoint,
} from "./transport.js";

const MAX_CONTEXT_TURNS = 10;
const DEFAULT_RELAY_URL = "https://jev-language-typesafe-relay.nolane-file.workers.dev";
const CONNECT_TIMEOUT_MS = 12000;
const REQUEST_TIMEOUT_MS = 30000;
const RELAY_CONNECT_ATTEMPTS = 3;
const RELAY_BROWSER_CONTRACT = "jev-relay-browser-v2";
const RELAY_RETRY_DELAYS_MS = [280, 850];
const RELAY_READY_TTL_MS = 30_000;

const state = {
  apiKey: "",
  model: "jev-latest",
  relayBaseUrl: DEFAULT_RELAY_URL,
  connected: false,
  busy: false,
  relayReadyAt: 0,
  relayPreflightToken: 0,
  turns: [],
};

const els = {
  runtimeState: document.querySelector("#runtimeState"),
  openKeyButton: document.querySelector("#openKeyButton"),
  keyButtonLabel: document.querySelector("#keyButtonLabel"),
  keyDialog: document.querySelector("#keyDialog"),
  closeKeyButton: document.querySelector("#closeKeyButton"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  modelSelect: document.querySelector("#modelSelect"),
  keyPanelIntro: document.querySelector("#keyPanelIntro"),
  browserConsent: document.querySelector("#browserConsent"),
  browserConsentText: document.querySelector("#browserConsentText"),
  toggleKeyVisibility: document.querySelector("#toggleKeyVisibility"),
  connectButton: document.querySelector("#connectButton"),
  disconnectButton: document.querySelector("#disconnectButton"),
  keyPanelStatus: document.querySelector("#keyPanelStatus"),
  composerForm: document.querySelector("#composerForm"),
  composerInput: document.querySelector("#composerInput"),
  sendButton: document.querySelector("#sendButton"),
  thread: document.querySelector("#thread"),
  emptyState: document.querySelector("#emptyState"),
  chatRegion: document.querySelector("#chatRegion"),
  messageTemplate: document.querySelector("#messageTemplate"),
  promptChips: [...document.querySelectorAll("[data-prompt]")],
};

function setRuntime(kind, label) {
  els.runtimeState.dataset.state = kind;
  els.runtimeState.querySelector("span").textContent = label;
}

function setKeyStatus(message = "", kind = "") {
  els.keyPanelStatus.textContent = message;
  els.keyPanelStatus.dataset.state = kind;
}

function updateConnectionUi() {
  els.keyButtonLabel.textContent = state.connected ? "Connected" : "Connect key";
  els.disconnectButton.hidden = !state.connected;
  const connectedLabel = `${state.model} · secure relay`;
  setRuntime(
    state.connected ? "connected" : "idle",
    state.connected ? connectedLabel : "Local shell",
  );
}

function updateSendState() {
  const hasText = els.composerInput.value.trim().length > 0;
  els.sendButton.disabled = state.busy || !hasText;
}

function autoresize() {
  els.composerInput.style.height = "auto";
  els.composerInput.style.height = `${Math.min(els.composerInput.scrollHeight, 180)}px`;
}

function serializeDetails(details) {
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

function addMessage(role, text, { details = null, loading = false } = {}) {
  const node = els.messageTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.role = role;
  if (loading) node.dataset.loading = "true";
  const meta = node.querySelector(".message__meta");
  const body = node.querySelector(".message__body");
  const detailEl = node.querySelector(".message__details");
  meta.textContent = role === "assistant" ? "JEV Language" : "You";

  if (loading) {
    body.innerHTML = '<span class="thinking-line" aria-label="Thinking"><span></span><span></span><span></span></span>';
  } else {
    body.textContent = text;
  }

  if (details) {
    detailEl.hidden = false;
    detailEl.querySelector("pre").textContent = serializeDetails(details);
  }

  els.thread.append(node);
  els.emptyState.hidden = true;
  requestAnimationFrame(() => {
    els.chatRegion.scrollTo({ top: els.chatRegion.scrollHeight, behavior: "smooth" });
  });
  return node;
}

function replaceLoadingMessage(node, text, details = null) {
  node.dataset.loading = "false";
  node.querySelector(".message__body").textContent = text;
  const detailEl = node.querySelector(".message__details");
  if (details) {
    detailEl.hidden = false;
    detailEl.querySelector("pre").textContent = serializeDetails(details);
  }
}

function normalizedContext() {
  return state.turns.slice(-MAX_CONTEXT_TURNS).map((turn) => ({
    role: turn.role,
    text: turn.text,
  }));
}

function buildState(latest) {
  return {
    latest_user_message: latest,
    conversation: normalizedContext(),
    note: "The UI is a JEV Language experimental playground. Preserve uncertainty. Do not infer evidence that is not in the state.",
  };
}

function makeHttpError(response, body, fallback) {
  const message =
    body?.error?.message ||
    body?.message ||
    fallback ||
    `Request returned HTTP ${response.status}.`;
  const error = new Error(message);
  error.status = response.status;
  error.body = body;
  return error;
}

function isTransientRelayFailure(error) {
  return (
    error?.name === "AbortError" ||
    isBrowserNetworkFailure(error) ||
    [502, 503, 504].includes(error?.status)
  );
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function withRelayRetry(task, {
  attempts = RELAY_CONNECT_ATTEMPTS,
  onRetry = () => {},
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (!isTransientRelayFailure(error) || attempt >= attempts) throw error;
      onRetry(error, attempt + 1, attempts);
      await wait(RELAY_RETRY_DELAYS_MS[Math.min(attempt - 1, RELAY_RETRY_DELAYS_MS.length - 1)]);
    }
  }
  throw lastError;
}

function relayRecentlyReady() {
  return (
    state.relayReadyAt > 0 &&
    Date.now() - state.relayReadyAt < RELAY_READY_TTL_MS
  );
}

async function preflightRelayConnection() {
  const token = ++state.relayPreflightToken;
  els.connectButton.disabled = true;
  els.connectButton.textContent = "Preparing…";
  setKeyStatus("Preparing the secure JEV relay…");

  try {
    await withRelayRetry(
      () => verifyRelayHealth(),
      {
        onRetry: (_error, nextAttempt, attempts) => {
          if (token !== state.relayPreflightToken) return;
          setKeyStatus(
            `Secure relay is warming up. Retrying ${nextAttempt}/${attempts}…`,
          );
        },
      },
    );

    if (token !== state.relayPreflightToken) return;
    state.relayReadyAt = Date.now();
    setKeyStatus(
      "Secure relay ready. Paste your TypeSafe key to continue.",
      "success",
    );
    els.connectButton.textContent = "Connect";
  } catch (error) {
    if (token !== state.relayPreflightToken) return;
    state.relayReadyAt = 0;

    if (
      error?.code === "UNVERIFIED_RELAY_RESPONSE" ||
      error?.code === "INVALID_RELAY_HEALTH"
    ) {
      setKeyStatus(
        "Secure relay verification did not complete. Retry in a moment; your API key has not been sent.",
        "warning",
      );
    } else {
      setKeyStatus(
        "Secure relay is taking longer than expected. You can retry when you connect; your API key has not been sent.",
        "warning",
      );
    }
    els.connectButton.textContent = "Retry & connect";
  } finally {
    if (token === state.relayPreflightToken) {
      els.connectButton.disabled = false;
    }
  }
}

async function relayFetch(path, {
  apiKey = "",
  method = "GET",
  body = undefined,
  timeoutMs = CONNECT_TIMEOUT_MS,
} = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(resolveRelayEndpoint({
      relayBaseUrl: state.relayBaseUrl,
      path,
    }), {
      method,
      mode: "cors",
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const bodyText = await response.text();
    let payload;
    try {
      payload = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      payload = { raw: bodyText };
    }

    if (response.headers.get("x-jev-relay") !== "1") {
      const error = new Error(
        "The secure relay answered, but the browser could not read its verification header.",
      );
      error.code = "UNVERIFIED_RELAY_RESPONSE";
      error.relayResponded = true;
      throw error;
    }

    if (!response.ok) {
      throw makeHttpError(response, payload);
    }

    return { response, payload };
  } finally {
    window.clearTimeout(timeout);
  }
}

async function verifyRelayHealth() {
  const { payload } = await relayFetch("/health", {
    timeoutMs: CONNECT_TIMEOUT_MS,
  });
  if (
    payload?.ok !== true ||
    payload?.relay !== "jev-language-typesafe" ||
    payload?.stores_credentials !== false ||
    payload?.browser_contract !== RELAY_BROWSER_CONTRACT
  ) {
    const error = new Error("The secure relay health response was not valid.");
    error.code = "INVALID_RELAY_HEALTH";
    throw error;
  }
}

async function callJev(questions, latest) {
  if (!state.connected || !state.apiKey) {
    throw new Error("Connect a TypeSafe API key before sending a decision-shaped prompt.");
  }

  const started = performance.now();
  const { response, payload } = await relayFetch("/v1/systemone", {
    apiKey: state.apiKey,
    method: "POST",
    body: {
      model: state.model,
      state: buildState(latest),
      questions,
    },
    timeoutMs: REQUEST_TIMEOUT_MS,
  });

  const validatedBody = validateSystemOneResponse(payload, questions);

  return {
    body: validatedBody,
    latencyMs: Math.round(performance.now() - started),
    requestId: response.headers.get("x-typesafe-request-id"),
  };
}

async function resolvePrompt(text) {
  if (isGreeting(text)) {
    return {
      text: "Hello. Give me a yes/no question or an explicit choice such as “retry or fail-fast?” and I’ll route it through Jev.",
      details: { local: true, reason: "deterministic greeting; no API quota consumed" },
    };
  }

  const options = extractOptions(text);
  if (options) {
    const result = await callJev({
      decision: choiceQuestion(
        "Choose the option that is better supported by the latest user request and conversation context. Preserve uncertainty through confidence rather than inventing facts.",
        ["option_a", "option_b"],
      ),
    }, text);
    return {
      text: renderChoice(answerAt(result.body, "decision"), options),
      details: { type: "choice", options, ...result },
    };
  }

  if (yesNoLike(text)) {
    const result = await callJev({
      answer: noulQuestion(
        "Answer the latest user's yes/no proposition. Use only the supplied conversation state and ordinary decision judgment; calibrated probability must express uncertainty.",
      ),
      posture: choiceQuestion(
        "What posture best fits the answer?",
        ["direct", "cautious", "needs_more_context"],
      ),
    }, text);
    return {
      text: renderYesNo(answerAt(result.body, "answer"), answerAt(result.body, "posture")),
      details: { type: "yes-no", ...result },
    };
  }

  const result = await callJev({
    mode: choiceQuestion("Classify the latest user message by response shape.", [
      "factual_open",
      "advice",
      "classification",
      "comparison",
      "instruction",
      "casual",
      "other",
    ]),
    answerability: scoreQuestion(
      "How safely can the current typed-decision surface answer this without a free-form string generator?",
      [
        "Not answerable without inventing an output space",
        "Partially answerable as a decision",
        "Directly answerable as a bounded decision",
      ],
    ),
    needs_clarification: noulQuestion(
      "Would an explicit yes/no proposition or explicit candidate choices materially improve answerability?",
    ),
  }, text);
  return {
    text: renderMeta(result.body),
    details: { type: "coverage-check", ...result },
  };
}

async function submitMessage(text) {
  const clean = text.trim();
  if (!clean || state.busy) return;

  if (!state.connected && !isGreeting(clean)) {
    els.apiKeyInput.value = "";
    els.keyDialog.showModal();
    setKeyStatus("Connect a key first. It will stay in this tab’s memory only.");
    return;
  }

  state.busy = true;
  updateSendState();
  setRuntime("busy", "Jev decision");
  addMessage("user", clean);
  state.turns.push({ role: "user", text: clean });
  els.composerInput.value = "";
  autoresize();

  const loading = addMessage("assistant", "", { loading: true });
  try {
    const result = await resolvePrompt(clean);
    replaceLoadingMessage(loading, result.text, result.details);
    state.turns.push({ role: "assistant", text: result.text });
    updateConnectionUi();
  } catch (error) {
    const status = error?.status;
    let message = "The request failed without a trustworthy result.";
    if (error?.name === "AbortError") {
      message = "Jev is taking longer than expected. Your key is still connected; please retry.";
    } else if (status === 401) {
      message = "This API key is no longer accepted. Reconnect with a valid TypeSafe key.";
      state.apiKey = "";
      state.connected = false;
    } else if (status === 403) {
      message = "This TypeSafe account does not have permission for the requested Jev operation.";
    } else if (status === 429) {
      message = "TypeSafe has rate-limited this key. Please wait briefly and retry.";
    } else if (isBrowserNetworkFailure(error)) {
      message = "The connection was interrupted before Jev replied. Your key is still connected; please retry.";
    } else if (error?.message) {
      message = error.message;
    }

    replaceLoadingMessage(loading, message, {
      error: true,
      status: status ?? null,
      message: error?.message ?? String(error),
    });
    setRuntime("error", "Request failed");
  } finally {
    state.busy = false;
    updateSendState();
    els.composerInput.focus();
  }
}

async function connectKey() {
  const key = els.apiKeyInput.value.trim();
  if (!key) {
    setKeyStatus("Paste a TypeSafe API key first.", "error");
    return;
  }
  if (!els.browserConsent.checked) {
    setKeyStatus("Confirm the in-flight key handling before connecting.", "error");
    return;
  }

  els.connectButton.disabled = true;
  els.connectButton.textContent = "Checking…";
  setKeyStatus("Checking the secure JEV relay…");

  try {
    if (!relayRecentlyReady()) {
      await withRelayRetry(
        () => verifyRelayHealth(),
        {
          onRetry: (_error, nextAttempt, attempts) => {
            setKeyStatus(
              `Secure relay did not answer yet. Retrying ${nextAttempt}/${attempts}…`,
            );
          },
        },
      );
      state.relayReadyAt = Date.now();
    }
    setKeyStatus("Relay ready. Verifying your TypeSafe key…");

    const { payload } = await withRelayRetry(
      () => relayFetch("/v1/models", {
        apiKey: key,
        timeoutMs: CONNECT_TIMEOUT_MS,
      }),
      {
        onRetry: (_error, nextAttempt, attempts) => {
          setKeyStatus(
            `TypeSafe verification was interrupted. Retrying ${nextAttempt}/${attempts}…`,
          );
        },
      },
    );

    const models = validateModelsResponse(payload);
    const names = models
      .map((model) => model.name)
      .filter((name) => typeof name === "string" && name.trim());

    if (names.length > 0) {
      const previous = els.modelSelect.value;
      els.modelSelect.replaceChildren(...names.map((name) => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        return option;
      }));
      els.modelSelect.value = names.includes(previous)
        ? previous
        : (names.includes("jev-latest") ? "jev-latest" : names[0]);
    }

    state.apiKey = key;
    state.model = els.modelSelect.value;
    state.connected = true;
    els.apiKeyInput.value = "";
    setKeyStatus("Connected securely for this tab. The key was not stored.", "success");
    updateConnectionUi();
    window.setTimeout(() => els.keyDialog.close(), 320);
    els.composerInput.focus();
  } catch (error) {
    state.apiKey = "";
    state.connected = false;

    let message;
    if (error?.status === 401) {
      message = "TypeSafe rejected this API key. Check the key and try again.";
    } else if (error?.status === 403) {
      message = "This TypeSafe key does not have access to Jev.";
    } else if (error?.status === 429) {
      message = "TypeSafe is rate-limiting this key. Wait briefly and try again.";
    } else if (error?.code === "UNVERIFIED_RELAY_RESPONSE") {
      message = "The secure relay answered, but browser verification was blocked. The key was not stored. Reload the page and try again.";
    } else if (error?.code === "INVALID_RELAY_HEALTH") {
      message = "The secure relay answered with an unexpected health response. The key was not stored; please retry shortly.";
    } else if (
      error?.name === "AbortError" ||
      isBrowserNetworkFailure(error) ||
      [502, 503, 504].includes(error?.status)
    ) {
      message = "The secure relay could not be reached after several attempts. Your key was not stored; please retry.";
    } else {
      message = error?.message || "The connection check could not be completed.";
    }

    const statusKind =
      error?.status === 401 ||
      error?.status === 403 ||
      error?.code === "UNVERIFIED_RELAY_RESPONSE"
        ? "error"
        : "warning";
    setKeyStatus(message, statusKind);
    updateConnectionUi();
  } finally {
    els.connectButton.disabled = false;
    els.connectButton.textContent = "Connect";
  }
}

function disconnectKey() {
  state.apiKey = "";
  state.connected = false;
  setKeyStatus("Disconnected. The in-memory key was cleared.", "success");
  updateConnectionUi();
}

els.openKeyButton.addEventListener("click", () => {
  els.modelSelect.value = state.model;
  els.browserConsent.checked = false;
  els.keyDialog.showModal();

  if (state.connected) {
    state.relayPreflightToken += 1;
    setKeyStatus(
      "A TypeSafe key is connected in memory for this tab.",
      "success",
    );
    els.connectButton.textContent = "Connect";
    els.connectButton.disabled = false;
  } else {
    void preflightRelayConnection();
  }

  window.setTimeout(() => els.apiKeyInput.focus(), 30);
});
els.closeKeyButton.addEventListener("click", () => {
  state.relayPreflightToken += 1;
  setKeyStatus("");
});
els.connectButton.addEventListener("click", connectKey);
els.disconnectButton.addEventListener("click", disconnectKey);

els.modelSelect.addEventListener("change", () => {
  if (!state.connected) return;
  state.model = els.modelSelect.value;
  updateConnectionUi();
});
els.toggleKeyVisibility.addEventListener("click", () => {
  const show = els.apiKeyInput.type === "password";
  els.apiKeyInput.type = show ? "text" : "password";
  els.toggleKeyVisibility.setAttribute("aria-label", show ? "Hide API key" : "Show API key");
});

els.composerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitMessage(els.composerInput.value);
});
els.composerInput.addEventListener("input", () => {
  autoresize();
  updateSendState();
});
els.composerInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submitMessage(els.composerInput.value);
  }
});
els.promptChips.forEach((button) => {
  button.addEventListener("click", () => {
    els.composerInput.value = button.dataset.prompt || "";
    autoresize();
    updateSendState();
    els.composerInput.focus();
  });
});

els.keyDialog.addEventListener("click", (event) => {
  if (event.target === els.keyDialog) els.keyDialog.close();
});

if (new URLSearchParams(location.search).has("preview")) {
  els.emptyState.hidden = true;
  addMessage("user", "For a latency-sensitive path, should I choose retry or fail-fast?");
  addMessage("assistant", "Jev chooses fail-fast with 78% confidence. Option weights: retry 22%, fail-fast 78%.", {
    details: {
      preview: true,
      note: "Visual preview only — no TypeSafe request was made.",
      answers: { decision: { choice: "option_b", confidence: 0.78, probabilities: { option_a: 0.22, option_b: 0.78 } } },
    },
  });
}

autoresize();
updateSendState();
updateConnectionUi();
