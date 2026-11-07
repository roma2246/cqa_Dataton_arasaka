"""OpenAI-совместимый адаптер (Gemini) без сети. Владелец: Участник 2."""
import io
import json
import urllib.error

import pytest

from cqa.config import settings
from cqa.evaluator import llm_client

SCHEMA = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"], "additionalProperties": False}


class FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture()
def gemini(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "openai_compat")
    monkeypatch.setattr(settings, "llm_model", "gemini-3.8-flash")
    monkeypatch.setattr(settings, "llm_base_url", "")
    monkeypatch.setattr(settings, "llm_api_key", "test-key")
    monkeypatch.setattr(settings, "llm_effort", "xhigh")
    monkeypatch.setattr(settings, "llm_price_input_per_m", 0.0)
    monkeypatch.setattr(settings, "llm_price_output_per_m", 0.0)
    monkeypatch.setattr(llm_client.time, "sleep", lambda s: None)
    sent = []

    def install(responses):
        it = iter(responses)

        def fake_urlopen(req, timeout=None, context=None):
            sent.append((req.full_url, json.loads(req.data)))
            r = next(it)
            if isinstance(r, Exception):
                raise r
            return FakeResp(json.dumps(r).encode())
        monkeypatch.setattr(llm_client.urllib.request, "urlopen", fake_urlopen)
        return sent
    return install


OK = {"model": "gemini-3.8-flash", "choices": [{"message": {"content": '{"ok": true}'}, "finish_reason": "stop"}],
      "usage": {"prompt_tokens": 1000, "completion_tokens": 100, "total_tokens": 1500}}


def test_request_shape_and_thinking_tokens_counted(gemini):
    sent = gemini([OK])
    r = llm_client.chat_json("sys", "user", SCHEMA)
    url, body = sent[0]
    assert url == "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    assert body["response_format"]["type"] == "json_schema"
    assert body["response_format"]["json_schema"]["schema"] == SCHEMA
    assert body["reasoning_effort"] == "high" and "temperature" not in body
    c = r.calls[0]
    assert (c.input_tokens, c.output_tokens) == (1000, 500)  # 500 = total - prompt (с размышлениями)
    assert llm_client.cost_usd(r.calls) == pytest.approx((1000 * 0.75 + 500 * 3.75) / 1e6)


def test_schema_rejected_falls_back_to_json_object(gemini):
    err = urllib.error.HTTPError("u", 400, "bad", {}, io.BytesIO(b'{"error":"schema"}'))
    sent = gemini([err, OK])
    r = llm_client.chat_json("sys", "user", SCHEMA)
    assert [b["response_format"]["type"] for _, b in sent] == ["json_schema", "json_object"]
    assert r.text == '{"ok": true}' and len(r.calls) == 2


def test_truncated_answer_is_error(gemini):
    cut = json.loads(json.dumps(OK))
    cut["choices"][0]["finish_reason"] = "length"
    gemini([cut])
    with pytest.raises(llm_client.LLMError) as e:
        llm_client.chat_json("sys", "user", SCHEMA)
    assert e.value.calls[0].output_tokens == 500  # обрезанный ответ всё равно оплачен


def test_missing_key(gemini, monkeypatch):
    monkeypatch.setattr(settings, "llm_api_key", "")
    with pytest.raises(llm_client.LLMError, match="LLM_API_KEY"):
        llm_client.chat_json("sys", "user", SCHEMA)
