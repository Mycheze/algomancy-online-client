# Algomancy Bot — Per-Question Cost Estimate

**Date:** 2026-06-23 · **Model:** `deepseek-v4-flash` · **Assumption:** every call is a **cache miss**.

> **Update (after adding the full keyword glossary):** the primer grew from ~1,230 to
> ~1,435 tokens, so system+primer is now ~2,040 tok and a normal question's input is
> ~3,635 tok. That nudges cost to **≈ $0.00055/question (~$0.55 per 1,000)**. The
> breakdown and method below are unchanged; only the primer token count grew by ~210.

## Pricing (DeepSeek, per 1M tokens)

Source: <https://api-docs.deepseek.com/quick_start/pricing>

| Model | Input (cache miss) | Input (cache hit) | Output |
|-------|-------------------:|------------------:|-------:|
| `deepseek-v4-flash` | **$0.14** | $0.0028 | **$0.28** |
| `deepseek-v4-pro`   | $0.435 | $0.003625 | $0.87 |

DeepSeek bills on **input tokens + output tokens** combined.

## Method

- Reconstructed the **exact prompt the current code sends** for every one of the **32 logged
  Q&As** in `logs/responses.jsonl`: `SYSTEM_PROMPT + PRIMER` (system), prior thread turns with
  citations stripped (follow-ups only), then the user message = the 6 retrieved chunks
  (`TOP_K=6`, full text) + the question. Output = the logged answer.
- **Token counting:** the real DeepSeek tokenizer isn't available offline, so I used the same
  **4 chars/token** ratio the project's `build_corpus.py` uses (`approx_tokens = len(s)//4`).
  See the caveat at the bottom.
- All input billed at the **cache-miss** rate ($0.14/M) as requested — i.e. worst case. (In
  practice the 1,829-token system+primer block would cache-hit after the first call and cost
  ~50× less on the input side.)

## Result — a normal question (fresh `&ask`, no thread history)

| Component | Tokens |
|-----------|-------:|
| System prompt + primer (fixed every call) | 1,829 |
| Retrieved chunks (6 × ~260 tok) | ~1,562 |
| Question + wrapper text | ~34 |
| **Input total** | **~3,425** |
| **Output (answer)** | **~140** |

**Cost per question:**

```
input :  3,425 tok × $0.14 / 1,000,000  = $0.00047950
output :   140 tok × $0.28 / 1,000,000  = $0.00003920
                                  TOTAL  ≈ $0.000519  per question
```

### ≈ **$0.00052 per question**  →  **~$0.52 per 1,000 questions**  →  **~1,930 questions per $1**

Input dominates: **~92%** of the cost is the input (the system+primer + 6 retrieved chunks),
only ~8% is the generated answer.

## Other scenarios

| Scenario | Input tok | Output tok | Cost/question |
|----------|----------:|-----------:|--------------:|
| **Normal `&ask`** (above) | 3,425 | 140 | **$0.00052** |
| Thread follow-up (avg history 216 tok) | 3,351 | 158 | $0.00051 |
| Verbose answer (~250-word cap ≈ 330 tok out) | 3,425 | 330 | $0.00057 |
| Same question on `deepseek-v4-pro` | 3,425 | 140 | $0.00161 (~3.1×) |

### "Math mode" (thinking enabled) — costs more, hard to pin exactly
When `needs_reasoning()` fires, DeepSeek emits chain-of-thought **`reasoning_content` that is
billed as output tokens** (same $0.28/M). Reasoning traces commonly run 500–2,000+ tokens, so a
math-mode answer likely lands around **$0.0007–$0.0011** — i.e. **~1.5–2×** a normal question,
dominated by the extra output. Only the questions the detector flags pay this; it's not the
average. (Couldn't measure precisely offline — confirm with `usage.completion_tokens` on the
first live math-mode call.)

## Caveat on accuracy

The 4-chars/token ratio is the project's own estimate, not DeepSeek's real tokenizer. Our prompts
are **symbol-heavy** (card text like `{i}[Switch1]{/n}`, ids like `[manual:0023]`), which BPE
tokenizers split into *more* tokens than plain prose. DeepSeek's documented English ratio
(~3.3 chars/token) would raise every count by ~15–20%, pushing a normal question to roughly
**$0.0006**. So treat **$0.0005–$0.0006 per question** as the realistic band; the figure is an
estimate, not a measured token count. For an exact number, read `response.usage`
(`prompt_tokens` / `completion_tokens`) on a live call.
