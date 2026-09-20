# Known limitations

The canonical machine-readable limitation inventory is `docs/unsupported-cases.json`.

Current declared limitations include:

- unrestricted open-domain NLU/NLG is not claimed;
- Vietnamese coverage is a verified declared subset, not complete unrestricted grammar/pragmatics;
- repair is bounded to registered families and budgets;
- Universal Expression program adapters cover declared PIR/backend subsets rather than every programming-language feature;
- the in-tree real solver proves only its declared bounded propositional Boolean fragment;
- native sign-language, gesture, visual-scene, and broad multimodal grounding are future research.

Coverage by major phenomenon is published in `docs/coverage-v0.4.json` and deliberately uses `partial` where broad support is not established.

Original M19 natural-conversation human evaluation remains incomplete until real blinded ratings are collected. Deterministic proxies may not be substituted for those ratings.
