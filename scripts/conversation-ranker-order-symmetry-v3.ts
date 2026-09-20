export {};

const RELAY_URL =
  process.env.JEV_RELAY_URL ??
  "https://jev-language-typesafe-relay.nolane-file.workers.dev";
const ORIGIN = "https://nolane-x.github.io";
const MAX_REQUESTS = 20;

if (process.env.JEV_ALLOW_LIVE !== "1") {
  throw new Error("Live order-symmetry evaluation is disabled.");
}
if (Number(process.env.JEV_LIVE_MAX_REQUESTS ?? MAX_REQUESTS) !== MAX_REQUESTS) {
  throw new Error(`Order-symmetry evaluation is hard-limited to ${MAX_REQUESTS} requests.`);
}
const apiKey = process.env.TYPESAFE_API_KEY;
if (!apiKey) throw new Error("TYPESAFE_API_KEY is not available.");
if (!/^https:\/\/[a-z0-9.-]+\.workers\.dev$/iu.test(RELAY_URL)) {
  throw new Error("JEV_RELAY_URL must be an HTTPS workers.dev origin.");
}

type BaseCase = {
  id: string;
  language: string;
  category: string;
  context: string;
  candidateA: string;
  candidateB: string;
  preferred: "candidate_a" | "candidate_b";
  instruction: string;
};

const baseCases: BaseCase[] = [
  {
    id: "vi-teacher-particle",
    language: "vi",
    category: "register",
    context:
      "Một học sinh xác nhận với thầy giáo rằng đã hiểu yêu cầu và sẽ sửa bài. Cả hai câu đều đúng nghĩa; cần chọn câu hợp ngữ cảnh hơn.",
    candidateA: "Dạ, em hiểu rồi ạ. Em sẽ sửa phần đó.",
    candidateB: "Dạ, em hiểu rồi nhé. Em sẽ sửa phần đó.",
    preferred: "candidate_a",
    instruction:
      "Chọn câu tự nhiên và phù hợp vai giao tiếp học sinh nói với thầy hơn. Đừng chỉ chọn theo độ dài.",
  },
  {
    id: "vi-peer-economy",
    language: "vi",
    category: "economy",
    context:
      "Đồng đội hỏi ngắn gọn “Xong chưa?” sau khi bạn vừa sửa lỗi và kiểm tra lại. Cả hai câu cùng truyền đạt đã xong và đã kiểm tra.",
    candidateA: "Xong rồi nhé, mình vừa kiểm tra lại.",
    candidateB:
      "Mình đã hoàn thành việc đó rồi nhé và mình vừa tiến hành kiểm tra lại.",
    preferred: "candidate_a",
    instruction:
      "Chọn câu hợp với nhịp chat đồng đội hơn, vẫn giữ đủ ý đã xong và đã kiểm tra.",
  },
  {
    id: "vi-correction-ownership",
    language: "vi",
    category: "correction",
    context:
      "Người dùng vừa sửa: “Không, ý mình là bản mobile chứ không phải web.” Trước đó trợ lý đã hiểu nhầm sang web.",
    candidateA: "À, mình hiểu nhầm. Mình xem bản mobile nhé.",
    candidateB: "Ừ, mình hiểu rồi. Mình xem bản mobile nhé.",
    preferred: "candidate_a",
    instruction:
      "Chọn câu tự nhiên hơn khi chính người trả lời cần thừa nhận vừa hiểu nhầm rồi áp dụng lời sửa.",
  },
  {
    id: "vi-calibrated-uncertainty",
    language: "vi",
    category: "uncertainty",
    context:
      "Chỉ có một phần log; timeout là giả thuyết mạnh nhất nhưng chưa đủ bằng chứng kết luận.",
    candidateA: "Có vẻ lỗi nằm ở timeout, nhưng mình chưa chắc.",
    candidateB: "Chắc là timeout rồi, nhưng cũng chưa biết.",
    preferred: "candidate_a",
    instruction:
      "Chọn câu vừa tự nhiên vừa thể hiện mức độ chắc chắn phù hợp với bằng chứng chưa đầy đủ.",
  },
  {
    id: "en-short-followup",
    language: "en",
    category: "economy",
    context:
      "A developer asks a very short follow-up: “And on Windows?” The same command works in PowerShell.",
    candidateA: "On Windows, use the same command in PowerShell.",
    candidateB: "For Windows, you can use the same command in PowerShell.",
    preferred: "candidate_a",
    instruction:
      "Choose the reply that fits the terse follow-up most naturally. Both are grammatical and semantically correct.",
  },
  {
    id: "en-correction-ownership",
    language: "en",
    category: "correction",
    context:
      "The user says: “No, I meant staging, not production.” The assistant had previously confused the two environments.",
    candidateA: "Right — I mixed those up. I'll check staging.",
    candidateB: "Got it. I'll check staging.",
    preferred: "candidate_a",
    instruction:
      "Choose the reply that best fits the context where the assistant itself made the earlier mix-up.",
  },
  {
    id: "zh-service-register",
    language: "zh-Hans",
    category: "register",
    context:
      "正式客户支持场景。客服需要告诉客户：已经检查，目前没有发现异常。两句话意思都对。",
    candidateA: "您好，我们已经核查过了，目前没有发现异常。",
    candidateB: "你好，我们看过了，现在没发现问题。",
    preferred: "candidate_a",
    instruction:
      "选择更符合正式客户支持语境、同时保持自然中文表达的句子。",
  },
  {
    id: "ja-workplace-register",
    language: "ja",
    category: "register",
    context:
      "職場で後輩が先輩に、確認した結果いまのところ問題がないと伝える。どちらも意味は通じる。",
    candidateA: "確認しました。今のところ問題は見つかっていません。",
    candidateB: "確認したところ、今のところ問題は見つかってないです。",
    preferred: "candidate_a",
    instruction:
      "職場の先輩への報告として、より自然で安定した丁寧さの表現を選んでください。",
  },
  {
    id: "es-service-register",
    language: "es",
    category: "register",
    context:
      "Atención formal al cliente. Hay que comunicar que se revisó el caso y por ahora no se detectó ningún problema.",
    candidateA:
      "Ya lo hemos revisado y, por ahora, no hemos detectado ningún problema.",
    candidateB: "Ya lo miramos y de momento no vemos nada raro.",
    preferred: "candidate_a",
    instruction:
      "Elige la opción más adecuada para atención formal al cliente sin sacrificar naturalidad.",
  },
  {
    id: "vi-en-dev-code-switch",
    language: "vi-en",
    category: "code-switch",
    context:
      "Nhóm dev Việt Nam dùng tự nhiên các từ production và rollback trong chat nội bộ. Hai câu đều đúng nghĩa kỹ thuật.",
    candidateA: "Nếu production vẫn lỗi thì mình rollback bản này trước nhé.",
    candidateB:
      "Nếu production vẫn lỗi thì mình sẽ hoàn tác bản này trước nhé.",
    preferred: "candidate_a",
    instruction:
      "Chọn câu hợp với đúng ngữ cảnh chat nội bộ của nhóm dev đã nêu, không mặc định rằng từ thuần Việt luôn tự nhiên hơn.",
  },
];

if (baseCases.length * 2 !== MAX_REQUESTS) {
  throw new Error("Base cases must expand to exactly the hard request budget.");
}

type ExpandedCase = BaseCase & {
  runId: string;
  mirrored: boolean;
  optionAId: "candidate_a" | "candidate_b";
  optionBId: "candidate_a" | "candidate_b";
  optionA: string;
  optionB: string;
  expectedOption: "option_a" | "option_b";
};

const expanded: ExpandedCase[] = baseCases.flatMap((item) => {
  const normal: ExpandedCase = {
    ...item,
    runId: `${item.id}:normal`,
    mirrored: false,
    optionAId: "candidate_a",
    optionBId: "candidate_b",
    optionA: item.candidateA,
    optionB: item.candidateB,
    expectedOption:
      item.preferred === "candidate_a" ? "option_a" : "option_b",
  };
  const mirrored: ExpandedCase = {
    ...item,
    runId: `${item.id}:mirrored`,
    mirrored: true,
    optionAId: "candidate_b",
    optionBId: "candidate_a",
    optionA: item.candidateB,
    optionB: item.candidateA,
    expectedOption:
      item.preferred === "candidate_a" ? "option_b" : "option_a",
  };
  return [normal, mirrored];
});

let requestsUsed = 0;
const results: Array<Record<string, unknown>> = [];

for (const testCase of expanded) {
  if (requestsUsed >= MAX_REQUESTS) {
    throw new Error("Live request budget exhausted before evaluation completion.");
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
          benchmark: "conversation-ranker-order-symmetry-v3",
          language: testCase.language,
          category: testCase.category,
          context: testCase.context,
          candidate_map: {
            option_a: testCase.optionA,
            option_b: testCase.optionB,
          },
          note:
            "Both options may be grammatical. Judge contextual naturalness/register/pragmatics, not option position.",
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
  if (!response.ok) {
    results.push({
      id: testCase.runId,
      base_id: testCase.id,
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

  if (response.headers.get("x-jev-relay") !== "1") {
    throw new Error(`Case ${testCase.runId} did not traverse the verified relay.`);
  }
  if (response.headers.get("access-control-allow-origin") !== ORIGIN) {
    throw new Error(`Case ${testCase.runId} did not preserve the expected CORS origin.`);
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
    throw new Error(`Case ${testCase.runId} returned an invalid response shape.`);
  }

  const selectedCandidateId =
    answer.choice === "option_a"
      ? testCase.optionAId
      : answer.choice === "option_b"
        ? testCase.optionBId
        : null;

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
    values.length >= 2 ? Number((values[0]! - values[1]!).toFixed(4)) : null;

  results.push({
    id: testCase.runId,
    base_id: testCase.id,
    mirrored: testCase.mirrored,
    language: testCase.language,
    category: testCase.category,
    ok: true,
    preferred_candidate: testCase.preferred,
    selected_candidate: selectedCandidateId,
    agreement_with_preregistered_preference:
      selectedCandidateId === testCase.preferred,
    selected_option: answer.choice,
    expected_option: testCase.expectedOption,
    observed: {
      confidence:
        typeof answer.confidence === "number" ? answer.confidence : null,
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

const successful = results.filter((entry) => entry.ok === true);
const preferenceAgreement = successful.filter(
  (entry) => entry.agreement_with_preregistered_preference === true,
);

const pairSummary = baseCases.map((baseCase) => {
  const pair = successful.filter((entry) => entry.base_id === baseCase.id);
  const selected = pair.map((entry) => entry.selected_candidate);
  const orderInvariant =
    pair.length === 2 &&
    selected[0] !== null &&
    selected[0] === selected[1];
  return {
    id: baseCase.id,
    language: baseCase.language,
    category: baseCase.category,
    successful_runs: pair.length,
    order_invariant: orderInvariant,
    selected_candidates: selected,
    preferred_candidate: baseCase.preferred,
    both_runs_match_preference:
      pair.length === 2 &&
      pair.every(
        (entry) => entry.agreement_with_preregistered_preference === true,
      ),
  };
});

const margins = successful
  .map((entry) =>
    Number((entry.observed as { margin?: number | null } | undefined)?.margin),
  )
  .filter((value) => Number.isFinite(value));
const confidences = successful
  .map((entry) =>
    Number(
      (entry.observed as { confidence?: number | null } | undefined)
        ?.confidence,
    ),
  )
  .filter((value) => Number.isFinite(value));

const mean = (values: readonly number[]): number | null =>
  values.length === 0
    ? null
    : Number(
        (
          values.reduce((sum, value) => sum + value, 0) / values.length
        ).toFixed(4),
      );

const optionASelections = successful.filter(
  (entry) => entry.selected_option === "option_a",
).length;

const totalInputTokens = successful.reduce(
  (sum, result) =>
    sum +
    Number(
      (result.usage as { input_tokens?: number } | undefined)?.input_tokens ??
        0,
    ),
  0,
);
const totalOutputTokens = successful.reduce(
  (sum, result) =>
    sum +
    Number(
      (result.usage as { output_tokens?: number } | undefined)?.output_tokens ??
        0,
    ),
  0,
);

const evidence = {
  schema: "jev-language-conversation-ranker-order-symmetry/v3",
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
    mirrored_runs_per_pair: 2,
    purpose:
      "Probe contextual naturalness on closer alternatives and detect left/right option-order sensitivity.",
    caveat:
      "Preregistered pair preferences are linguistic hypotheses, not a substitute for blinded human ratings.",
  },
  summary: {
    successful_requests: successful.length,
    preference_agreements: preferenceAgreement.length,
    preference_agreement_rate:
      successful.length === 0
        ? 0
        : Number((preferenceAgreement.length / successful.length).toFixed(4)),
    order_invariant_pairs: pairSummary.filter((pair) => pair.order_invariant)
      .length,
    order_invariance_rate:
      pairSummary.length === 0
        ? 0
        : Number(
            (
              pairSummary.filter((pair) => pair.order_invariant).length /
              pairSummary.length
            ).toFixed(4),
          ),
    both_runs_match_preference_pairs: pairSummary.filter(
      (pair) => pair.both_runs_match_preference,
    ).length,
    option_a_selection_rate:
      successful.length === 0
        ? 0
        : Number((optionASelections / successful.length).toFixed(4)),
    mean_margin: mean(margins),
    minimum_margin: margins.length === 0 ? null : Math.min(...margins),
    mean_confidence: mean(confidences),
    confidence_one_rate:
      confidences.length === 0
        ? 0
        : Number(
            (
              confidences.filter((value) => value === 1).length /
              confidences.length
            ).toFixed(4),
          ),
    input_tokens: totalInputTokens,
    output_tokens: totalOutputTokens,
  },
  pair_summary: pairSummary,
  cases: results,
  interpretation:
    "A strong result requires both contextual preference agreement and order invariance. It still measures Jev as a bounded ranker, not end-to-end free-form generation.",
};

console.log(JSON.stringify(evidence, null, 2));
