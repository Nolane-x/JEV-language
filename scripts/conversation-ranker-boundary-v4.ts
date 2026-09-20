export {};

const RELAY_URL =
  process.env.JEV_RELAY_URL ??
  "https://jev-language-typesafe-relay.nolane-file.workers.dev";
const ORIGIN = "https://nolane-x.github.io";
const MAX_REQUESTS = 20;
const DEFAULT_MIN_CONFIDENCE = 0.62;
const DEFAULT_MIN_MARGIN = 0.08;

if (process.env.JEV_ALLOW_LIVE !== "1") {
  throw new Error("Live conversation-ranker boundary evaluation is disabled.");
}
if (Number(process.env.JEV_LIVE_MAX_REQUESTS ?? MAX_REQUESTS) !== MAX_REQUESTS) {
  throw new Error(
    `Conversation-ranker boundary evaluation is hard-limited to ${MAX_REQUESTS} requests.`,
  );
}

const apiKey = process.env.TYPESAFE_API_KEY;
if (!apiKey) {
  throw new Error("TYPESAFE_API_KEY is not available.");
}
if (!/^https:\/\/[a-z0-9.-]+\.workers\.dev$/iu.test(RELAY_URL)) {
  throw new Error("JEV_RELAY_URL must be an HTTPS workers.dev origin.");
}

type BaseCase = {
  id: string;
  language: string;
  category:
    | "clear-preference"
    | "near-tie";
  context: string;
  candidateA: string;
  candidateB: string;
  preferred?: "candidate_a" | "candidate_b";
  instruction: string;
};

const baseCases: BaseCase[] = [
  {
    id: "vi-correction-clear",
    language: "vi",
    category: "clear-preference",
    context:
      "Người dùng vừa sửa: “Không, ý mình là bản mobile chứ không phải web.” Trước đó trợ lý đã hiểu nhầm sang web.",
    candidateA: "À, mình hiểu nhầm. Mình xem bản mobile nhé.",
    candidateB: "Ừ, mình hiểu rồi. Mình xem bản mobile nhé.",
    preferred: "candidate_a",
    instruction:
      "Chọn câu phù hợp hơn khi người trả lời cần thừa nhận chính mình vừa hiểu nhầm. Cả hai câu đều phải được xem là khả dĩ; ưu tiên độ khớp ngữ cảnh.",
  },
  {
    id: "en-uncertainty-clear",
    language: "en",
    category: "clear-preference",
    context:
      "Only part of the logs has been inspected. A timeout is currently the strongest hypothesis, but the evidence is not conclusive.",
    candidateA:
      "It looks like a timeout, but I’m not certain yet.",
    candidateB:
      "It is definitely a timeout.",
    preferred: "candidate_a",
    instruction:
      "Choose the reply that best matches the actual evidence state while still sounding conversational.",
  },
  {
    id: "zh-register-clear",
    language: "zh-Hans",
    category: "clear-preference",
    context:
      "客服人员正在礼貌地告诉客户：问题还在检查中，目前没有最终结论。",
    candidateA: "我们还在检查，目前还不能下结论，有结果会及时告诉您。",
    candidateB: "还没搞清楚，等着吧。",
    preferred: "candidate_a",
    instruction:
      "选择更符合客服场景、自然且礼貌的表达，同时不要假装已经有结论。",
  },
  {
    id: "ja-workplace-clear",
    language: "ja",
    category: "clear-preference",
    context:
      "職場で後輩が先輩に、調査は終わったが原因はまだ確定していないと報告する。",
    candidateA:
      "確認は終わりましたが、原因はまだ特定できていません。",
    candidateB:
      "見終わったけど、原因まだ分かんないっす。",
    preferred: "candidate_a",
    instruction:
      "職場の先輩への報告として、意味を保ちながら自然で適切な文を選んでください。",
  },
  {
    id: "vi-en-code-switch-clear",
    language: "vi-en",
    category: "clear-preference",
    context:
      "Nhóm dev Việt Nam thường dùng deploy, rollback và production trong chat nội bộ.",
    candidateA:
      "Nếu production vẫn lỗi thì mình rollback bản này trước nhé.",
    candidateB:
      "Nếu môi trường production vẫn lỗi thì mình thực hiện rollback hóa bản này trước nhé.",
    preferred: "candidate_a",
    instruction:
      "Chọn câu code-switch tự nhiên hơn trong chat dev Việt Nam, giữ nguyên ý kỹ thuật.",
  },

  {
    id: "vi-peer-near-tie",
    language: "vi",
    category: "near-tie",
    context:
      "Hai đồng đội thân thiện đang chat ngắn sau khi một người vừa kiểm tra lại bản sửa. Không có khác biệt về lịch sự hay ý nghĩa.",
    candidateA: "Xong rồi nhé, mình vừa kiểm tra lại.",
    candidateB: "Xong rồi, mình vừa kiểm tra lại nhé.",
    instruction:
      "Hai câu đều có thể tự nhiên. Nếu có khác biệt thì chỉ nên là sở thích rất nhẹ; đừng tạo ra khác biệt lớn khi ngữ cảnh không hỗ trợ.",
  },
  {
    id: "en-punctuation-near-tie",
    language: "en",
    category: "near-tie",
    context:
      "A teammate asks for a quick status update in casual developer chat. Both replies communicate the same content and register.",
    candidateA: "I checked it — looks good so far.",
    candidateB: "I checked it. Looks good so far.",
    instruction:
      "Both are ordinary conversational English. Treat any preference as weak unless the context gives a real reason.",
  },
  {
    id: "zh-temporal-near-tie",
    language: "zh-Hans",
    category: "near-tie",
    context:
      "两个同事在群里简短同步检查结果；“目前”和“暂时”在这里都符合语境。",
    candidateA: "我看过了，目前没发现问题。",
    candidateB: "我看过了，暂时没发现问题。",
    instruction:
      "两句都自然并且意思接近。除非存在明确语境依据，否则不要表现出很强的偏好。",
  },
  {
    id: "es-temporal-near-tie",
    language: "es",
    category: "near-tie",
    context:
      "Dos compañeros comentan brevemente el resultado de una revisión. Ambas expresiones temporales encajan con el contexto.",
    candidateA: "Ya lo revisé y por ahora no veo errores.",
    candidateB: "Lo revisé y de momento no veo errores.",
    instruction:
      "Las dos opciones son naturales y transmiten prácticamente lo mismo. Cualquier preferencia debería ser débil.",
  },
  {
    id: "ja-result-near-tie",
    language: "ja",
    category: "near-tie",
    context:
      "同僚への短い確認結果の共有。どちらも丁寧で、今の時点では問題がないことを伝えている。",
    candidateA: "確認しました。今のところ問題はありません。",
    candidateB: "確認しました。今のところ問題は見つかっていません。",
    instruction:
      "どちらも自然で文脈に合う表現です。明確な根拠がなければ、強い優劣を付けないでください。",
  },
];

if (baseCases.length * 2 !== MAX_REQUESTS) {
  throw new Error("Boundary benchmark must contain exactly 10 mirrored base pairs.");
}

type ExpandedCase = BaseCase & {
  id: string;
  baseId: string;
  mirrored: boolean;
  optionA: string;
  optionB: string;
  expectedOption?: "option_a" | "option_b";
};

const cases: ExpandedCase[] = baseCases.flatMap((base) => {
  const normal: ExpandedCase = {
    ...base,
    id: `${base.id}:normal`,
    baseId: base.id,
    mirrored: false,
    optionA: base.candidateA,
    optionB: base.candidateB,
    ...(base.preferred === undefined
      ? {}
      : {
          expectedOption:
            base.preferred === "candidate_a" ? "option_a" : "option_b",
        }),
  };
  const mirrored: ExpandedCase = {
    ...base,
    id: `${base.id}:mirrored`,
    baseId: base.id,
    mirrored: true,
    optionA: base.candidateB,
    optionB: base.candidateA,
    ...(base.preferred === undefined
      ? {}
      : {
          expectedOption:
            base.preferred === "candidate_a" ? "option_b" : "option_a",
        }),
  };
  return [normal, mirrored];
});

let requestsUsed = 0;
const results: Array<Record<string, unknown>> = [];

for (const testCase of cases) {
  if (requestsUsed >= MAX_REQUESTS) {
    throw new Error("Live request budget exhausted before benchmark completion.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const started = performance.now();
  let response: Response;

  try {
    requestsUsed += 1;
    response = await fetch(`${RELAY_URL}/v1/systemone`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: ORIGIN,
      },
      body: JSON.stringify({
        model: process.env.TYPESAFE_DEFAULT_MODEL ?? "jev-latest",
        state: {
          benchmark: "conversation-ranker-boundary-v4",
          language: testCase.language,
          category: testCase.category,
          dialogue_context: testCase.context,
          candidates: {
            option_a: testCase.optionA,
            option_b: testCase.optionB,
          },
          note:
            testCase.category === "near-tie"
              ? "This is a calibration boundary case. Both candidates are intentionally plausible."
              : "This is a held-out contextual preference case.",
        },
        questions: {
          answer: {
            type: "choice",
            instructions: testCase.instruction,
            criteria: {
              option_a: null,
              option_b: null,
            },
          },
        },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const latencyMs = Math.round(performance.now() - started);

  if (response.headers.get("x-jev-relay") !== "1") {
    throw new Error(
      `Case ${testCase.id} did not traverse the verified relay.`,
    );
  }
  if (response.headers.get("access-control-allow-origin") !== ORIGIN) {
    throw new Error(
      `Case ${testCase.id} did not preserve the expected CORS origin.`,
    );
  }

  if (!response.ok) {
    results.push({
      id: testCase.id,
      base_id: testCase.baseId,
      mirrored: testCase.mirrored,
      language: testCase.language,
      category: testCase.category,
      ok: false,
      http_status: response.status,
      latency_ms: latencyMs,
      error_body_persisted: false,
    });
    if (response.status === 401 || response.status === 403) break;
    continue;
  }

  const body = (await response.json()) as Record<string, any>;
  const answer = body?.answers?.answer;
  if (
    typeof body?.model !== "string" ||
    typeof body?.usage?.input_tokens !== "number" ||
    typeof body?.usage?.output_tokens !== "number" ||
    answer?.type !== "choice" ||
    typeof answer.choice !== "string"
  ) {
    throw new Error(
      `Case ${testCase.id} returned an invalid System One response shape.`,
    );
  }

  const probabilities =
    answer.probabilities && typeof answer.probabilities === "object"
      ? answer.probabilities
      : null;
  const values = probabilities
    ? Object.values(probabilities)
        .map(Number)
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => b - a)
    : [];

  const margin =
    values.length >= 2
      ? Number((values[0]! - values[1]!).toFixed(4))
      : null;
  const confidence =
    typeof answer.confidence === "number" ? answer.confidence : null;
  const selectedCandidate =
    answer.choice === "option_a"
      ? testCase.mirrored
        ? "candidate_b"
        : "candidate_a"
      : testCase.mirrored
        ? "candidate_a"
        : "candidate_b";

  const gateAccepts =
    confidence !== null &&
    margin !== null &&
    confidence >= DEFAULT_MIN_CONFIDENCE &&
    margin >= DEFAULT_MIN_MARGIN;

  const clearAgreement =
    testCase.category === "clear-preference"
      ? answer.choice === testCase.expectedOption
      : null;

  results.push({
    id: testCase.id,
    base_id: testCase.baseId,
    mirrored: testCase.mirrored,
    language: testCase.language,
    category: testCase.category,
    ok: true,
    ...(testCase.expectedOption === undefined
      ? {}
      : { expected_option: testCase.expectedOption }),
    selected_option: answer.choice,
    selected_candidate: selectedCandidate,
    clear_preference_agreement: clearAgreement,
    gate_accepts: gateAccepts,
    observed: {
      confidence,
      probabilities,
      margin,
    },
    model: body.model,
    usage: {
      input_tokens: body.usage.input_tokens,
      output_tokens: body.usage.output_tokens,
    },
    latency_ms: latencyMs,
    request_id: response.headers.get("x-typesafe-request-id"),
    relay_header_verified: true,
    cors_origin_verified: true,
  });
}

const successful = results.filter((result) => result.ok === true);
const clear = successful.filter(
  (result) => result.category === "clear-preference",
);
const nearTie = successful.filter((result) => result.category === "near-tie");

const basePairSummaries = baseCases.map((base) => {
  const pair = successful.filter((result) => result.base_id === base.id);
  const normal = pair.find((result) => result.mirrored === false);
  const mirrored = pair.find((result) => result.mirrored === true);
  const orderInvariant =
    normal !== undefined &&
    mirrored !== undefined &&
    normal.selected_candidate === mirrored.selected_candidate;

  return {
    base_id: base.id,
    language: base.language,
    category: base.category,
    complete: pair.length === 2,
    order_invariant: orderInvariant,
    normal_selected_candidate: normal?.selected_candidate ?? null,
    mirrored_selected_candidate: mirrored?.selected_candidate ?? null,
    normal_margin:
      (normal?.observed as { margin?: number } | undefined)?.margin ?? null,
    mirrored_margin:
      (mirrored?.observed as { margin?: number } | undefined)?.margin ?? null,
    normal_confidence:
      (normal?.observed as { confidence?: number } | undefined)?.confidence ??
      null,
    mirrored_confidence:
      (mirrored?.observed as { confidence?: number } | undefined)?.confidence ??
      null,
  };
});

const mean = (values: number[]): number | null =>
  values.length === 0
    ? null
    : Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4));

const numericField = (
  rows: Array<Record<string, unknown>>,
  field: "confidence" | "margin",
): number[] =>
  rows
    .map((row) => (row.observed as Record<string, unknown> | undefined)?.[field])
    .map(Number)
    .filter((value) => Number.isFinite(value));

const orderInvariantPairs = basePairSummaries.filter(
  (pair) => pair.order_invariant,
).length;
const clearAgreementCount = clear.filter(
  (row) => row.clear_preference_agreement === true,
).length;
const clearAcceptedCount = clear.filter(
  (row) => row.gate_accepts === true,
).length;
const nearTieAbstainedCount = nearTie.filter(
  (row) => row.gate_accepts === false,
).length;
const nearTieFalseCertaintyCount = nearTie.filter((row) => {
  const observed = row.observed as
    | { confidence?: number; margin?: number }
    | undefined;
  return (
    Number(observed?.confidence ?? 0) >= 0.9 ||
    Number(observed?.margin ?? 0) >= 0.8
  );
}).length;

const optionASelections = successful.filter(
  (row) => row.selected_option === "option_a",
).length;

const totalInputTokens = successful.reduce(
  (sum, row) =>
    sum +
    Number(
      (row.usage as { input_tokens?: number } | undefined)?.input_tokens ?? 0,
    ),
  0,
);
const totalOutputTokens = successful.reduce(
  (sum, row) =>
    sum +
    Number(
      (row.usage as { output_tokens?: number } | undefined)?.output_tokens ?? 0,
    ),
  0,
);

const evidence = {
  schema: "jev-language-conversation-ranker-boundary-v4",
  observed_at: new Date().toISOString(),
  source_sha: process.env.GITHUB_SHA ?? null,
  relay: RELAY_URL,
  origin: ORIGIN,
  request_budget: MAX_REQUESTS,
  requests_used: requestsUsed,
  credential_persisted: false,
  error_bodies_persisted: false,
  design: {
    base_pairs: baseCases.length,
    mirrored_requests_per_pair: 2,
    clear_preference_pairs: baseCases.filter(
      (item) => item.category === "clear-preference",
    ).length,
    near_tie_pairs: baseCases.filter(
      (item) => item.category === "near-tie",
    ).length,
    current_gate: {
      min_confidence: DEFAULT_MIN_CONFIDENCE,
      min_margin: DEFAULT_MIN_MARGIN,
    },
    near_tie_rule:
      "Near-tie pairs have no preregistered winner. The desired calibration behavior is low confidence/margin or gate abstention, not agreement with an invented gold label.",
  },
  summary: {
    successful_requests: successful.length,
    clear_preference_agreements: clearAgreementCount,
    clear_preference_requests: clear.length,
    clear_preference_agreement_rate:
      clear.length === 0
        ? 0
        : Number((clearAgreementCount / clear.length).toFixed(4)),
    clear_gate_accept_rate:
      clear.length === 0
        ? 0
        : Number((clearAcceptedCount / clear.length).toFixed(4)),
    near_tie_gate_abstentions: nearTieAbstainedCount,
    near_tie_requests: nearTie.length,
    near_tie_gate_abstention_rate:
      nearTie.length === 0
        ? 0
        : Number((nearTieAbstainedCount / nearTie.length).toFixed(4)),
    near_tie_false_certainty_rate:
      nearTie.length === 0
        ? 0
        : Number((nearTieFalseCertaintyCount / nearTie.length).toFixed(4)),
    order_invariant_pairs: orderInvariantPairs,
    complete_base_pairs: basePairSummaries.filter((pair) => pair.complete).length,
    order_invariance_rate:
      basePairSummaries.length === 0
        ? 0
        : Number((orderInvariantPairs / basePairSummaries.length).toFixed(4)),
    option_a_selection_rate:
      successful.length === 0
        ? 0
        : Number((optionASelections / successful.length).toFixed(4)),
    mean_clear_confidence: mean(numericField(clear, "confidence")),
    mean_clear_margin: mean(numericField(clear, "margin")),
    mean_near_tie_confidence: mean(numericField(nearTie, "confidence")),
    mean_near_tie_margin: mean(numericField(nearTie, "margin")),
    input_tokens: totalInputTokens,
    output_tokens: totalOutputTokens,
  },
  pair_summaries: basePairSummaries,
  cases: results,
  interpretation:
    "This v4 experiment probes calibration at the preference boundary. Clear pairs test contextual ranking; near-tie pairs intentionally have no gold winner and test whether confidence/margin gating avoids false certainty. It does not substitute for blinded human naturalness ratings.",
};

console.log(JSON.stringify(evidence, null, 2));
