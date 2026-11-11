from types import SimpleNamespace

import pytest

from pipeline.llm import LLM, AllModelsFailed, Budget, BudgetExceeded, parse_json, usage_cost


class APIErr(Exception):
    def __init__(self, status):
        super().__init__(f"status {status}")
        self.status_code = status


def resp(text="ok", cost=0.01):
    usage = SimpleNamespace(prompt_tokens=10, completion_tokens=5, model_extra={"cost": cost})
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))], usage=usage)


class FakeClient:
    def __init__(self, behaviour):
        self.behaviour = behaviour  # model -> list of results/exceptions, consumed in order
        self.calls = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, model, messages, **kw):
        self.calls.append(model)
        r = self.behaviour[model].pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def make(behaviour, cap=5.0):
    client = FakeClient(behaviour)
    return LLM(Budget(cap), client=client, chain=["a", "b", "c"], sleep=lambda s: None), client


def test_first_model_answers():
    llm, client = make({"a": [resp("hi")]})
    msg, used = llm.chat([{"role": "user", "content": "x"}])
    assert (msg.content, used, client.calls) == ("hi", "a", ["a"])
    assert llm.budget.spent == pytest.approx(0.01)


def test_falls_back_and_marks_refused_model_dead():
    llm, client = make({"a": [APIErr(403)], "b": [APIErr(500), resp("from b"), ], "c": [resp("from c")]})
    _, used = llm.chat([])
    assert used == "c" and "a" in llm.dead and "b" not in llm.dead
    # next call skips dead "a", retries "b"
    _, used = llm.chat([])
    assert used == "b" and client.calls == ["a", "b", "c", "b"]


def test_429_retried_on_same_model():
    llm, client = make({"a": [APIErr(429), APIErr(429), resp("ok")]})
    _, used = llm.chat([])
    assert used == "a" and client.calls == ["a", "a", "a"]


def test_402_stops_everything():
    llm, _ = make({"a": [APIErr(402)]})
    with pytest.raises(BudgetExceeded):
        llm.chat([])


def test_all_fail():
    llm, _ = make({"a": [APIErr(500)], "b": [APIErr(500)], "c": [APIErr(500)]})
    with pytest.raises(AllModelsFailed):
        llm.chat([])


def test_budget_cap_stops_calls():
    llm, client = make({"a": [resp(cost=0.6), resp()]}, cap=0.5)
    llm.chat([])
    with pytest.raises(BudgetExceeded):
        llm.chat([])
    assert client.calls == ["a"]


def test_usage_cost_estimate_when_gateway_silent():
    usage = SimpleNamespace(prompt_tokens=1_000_000, completion_tokens=1_000_000, model_extra={})
    assert usage_cost("deepseek-v4.1-flash", usage) == pytest.approx(1.50)


def test_parse_json_variants():
    assert parse_json('[{"a": 1}]') == [{"a": 1}]
    assert parse_json('Here you go:\n```json\n{"a": 2}\n```') == {"a": 2}
    assert parse_json('Result: [] done') == []
    with pytest.raises(ValueError):
        parse_json("no json")
