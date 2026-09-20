# Conversation microgrammar wave 2 — targeted recall closure

Status: deterministic engineering evidence, not blinded human naturalness evidence.

Wave 1 deliberately froze two preferred-surface misses:

- Vietnamese topic-comment reshaping: `Mình chưa kiểm tra phần mobile.` → `Còn phần mobile thì mình chưa kiểm tra.`
- English calibrated hedging: `The current evidence points to a timeout.` → `It looks like a timeout, but I'm not certain yet.`

Wave 2 adds only bounded, opt-in rules for those gaps.

## Vietnamese

`allowTopicCommentReshape` is explicit and the transformation is limited to a small pattern family:

- speaker form: Mình / Tôi / Em / Anh / Chị
- negative perfective-like frame: `chưa`
- verb set: `kiểm tra`, `xem`, `thử`
- explicit `phần <topic>` constituent

Unsupported verbs remain untouched.

## English

`allowCalibratedHedge` is explicit and requires `epistemicStatus: "uncertain"`.

The current rule only handles the bounded evidence frame:

`The current evidence points to <proposition>.`

It does not emit uncertainty language when the epistemic state is probable or certain.

## Result

The two preregistered wave-1 gaps are now generated in a targeted wave-2 recall fixture: **2 / 2 preferred surfaces present**.

The original wave-1 0.8 baseline remains unchanged because its cases do not enable the new wave-2 capabilities. This preserves the historical negative result instead of rewriting it after observation.

All generated variants remain proposals. They still require semantic certification before entering the bounded Jev ranking lattice.
