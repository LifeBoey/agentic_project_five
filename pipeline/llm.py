"""OpenCode chat client with a model fallback chain and a hard spending cap."""
from __future__ import annotations

import os
import threading
import time

from . import config


class BudgetExceeded(RuntimeError):
    pass


class AllModelsFailed(RuntimeError):
    pass


class Budget:
    def __init__(self, cap_usd: float):
        self.cap = cap_usd
        self.spent = 0.0
        self.calls: dict[str, int] = {}
        self._lock = threading.Lock()

    def check(self):
        with self._lock:
            if self.spent >= self.cap:
                raise BudgetExceeded(f"spent ${self.spent:.4f} of ${self.cap:.2f} cap")

    def add(self, model: str, cost: float):
        with self._lock:
            self.spent += cost
            self.calls[model] = self.calls.get(model, 0) + 1


def usage_cost(model: str, usage) -> float:
    """Cost in USD: the gateway's reported `usage.cost` if present, else a price-table estimate."""
    if usage is None:
        return 0.0
    extra = getattr(usage, "model_extra", None) or {}
    cost = extra.get("cost", getattr(usage, "cost", None))
    if isinstance(cost, (int, float)):
        return float(cost)
    pin, pout = config.MODEL_PRICES.get(model, (2.0, 10.0))
    return (usage.prompt_tokens or 0) * pin / 1e6 + (usage.completion_tokens or 0) * pout / 1e6


def _status(err) -> int | None:
    return getattr(err, "status_code", None)


class LLM:
    """chat() tries each model in the chain. 429 is retried with backoff; 402 (no credit) stops
    everything; any other error moves on to the next model, and models that are refused
    (403/404) are skipped for the rest of the run."""

    def __init__(self, budget: Budget, client=None, chain=None, sleep=time.sleep):
        if client is None:
            from openai import OpenAI

            client = OpenAI(
                api_key=os.environ["OPENCODE_API_KEY"],
                base_url=config.OPENCODE_BASE_URL,
                timeout=180,
                max_retries=0,
            )
        self.client = client
        self.budget = budget
        self.chain = list(chain or config.MODEL_CHAIN)
        self.dead: set[str] = set()
        self.errors: list[str] = []
        self._sleep = sleep

    def chat(self, messages, tools=None, **kw):
        """Returns (message, model_used)."""
        tried = []
        for model in self.chain:
            if model in self.dead:
                continue
            for attempt in range(4):
                self.budget.check()
                try:
                    args = dict(model=model, messages=messages, **kw)
                    if tools:
                        args["tools"] = tools
                    resp = self.client.chat.completions.create(**args)
                except Exception as err:  # noqa: BLE001 - any API failure means: try the next model
                    status = _status(err)
                    if status == 402:
                        raise BudgetExceeded(f"OpenCode reports no credit left (402): {err}") from err
                    if status == 429 and attempt < 3:
                        self._sleep(2 ** (attempt + 1))
                        continue
                    if status in (401, 403, 404):
                        self.dead.add(model)
                    self.errors.append(f"{model}: {status} {str(err)[:200]}")
                    tried.append(model)
                    break
                self.budget.add(model, usage_cost(model, getattr(resp, "usage", None)))
                if not resp.choices:
                    self.errors.append(f"{model}: empty choices")
                    tried.append(model)
                    break
                return resp.choices[0].message, model
        raise AllModelsFailed(f"all models failed: {tried}; last errors: {self.errors[-3:]}")


def parse_json(text: str):
    """Pull the first JSON object/array out of a model reply (handles ```json fences and chatter)."""
    import json
    import re

    text = (text or "").strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except ValueError:
        pass
    dec = json.JSONDecoder()
    for i, ch in enumerate(text):
        if ch in "[{":
            try:
                return dec.raw_decode(text[i:])[0]
            except ValueError:
                continue
    raise ValueError(f"no JSON found in reply: {text[:200]!r}")


def message_to_dict(msg) -> dict:
    """Assistant message -> plain dict suitable for sending back in the history."""
    d = {"role": "assistant", "content": msg.content or ""}
    if getattr(msg, "tool_calls", None):
        d["tool_calls"] = [
            {"id": tc.id, "type": "function",
             "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
            for tc in msg.tool_calls
        ]
    return d
