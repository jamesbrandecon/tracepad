import pandas as pd

from tracepad.runtime import RESULT_MIME, serialize_result


def test_serializes_dataframe_preview():
    frame = pd.DataFrame({"group": ["a", "b"], "value": [1.5, 2.0]})
    payload = serialize_result(
        frame,
        alias="summary",
        runtime_name="tracepad_result_1",
        turn_id="turn-1",
        turn_number="1",
    )

    assert RESULT_MIME == "application/vnd.tracepad.result+json"
    assert payload["kind"] == "data"
    assert payload["shape"] == [2, 2]
    assert payload["rows"][0] == {"group": "a", "value": 1.5}


def test_unwraps_legacy_dataframe_preview_dictionary():
    frame = pd.DataFrame({"group": ["a", "b"], "value": [1.5, 2.0]})
    payload = serialize_result(
        {
            "shape": (3000, 2),
            "columns": ["group", "value"],
            "head": frame,
            "dtypes": {"group": "object", "value": "float64"},
        },
        alias="orders",
        runtime_name="tracepad_result_1",
        turn_id="turn-1",
        turn_number="1",
    )

    assert payload["kind"] == "data"
    assert payload["typeName"] == "DataFrame"
    assert payload["shape"] == [3000, 2]
    assert payload["rows"][1] == {"group": "b", "value": 2.0}


def test_unwraps_legacy_record_preview_dictionary():
    payload = serialize_result(
        {
            "shape": [100, 2],
            "columns": ["group", "value"],
            "preview": [{"group": "a", "value": 1}],
        },
        alias="summary",
        runtime_name="tracepad_result_2",
        turn_id="turn-2",
        turn_number="2",
    )

    assert payload["kind"] == "data"
    assert payload["shape"] == [100, 2]
    assert payload["rows"] == [{"group": "a", "value": 1}]


def test_serializes_model_capabilities_and_coefficients():
    class Model:
        params = {"intercept": 1.0, "price": -0.5}

        def summary(self):
            return "A useful model summary"

        def predict(self):
            return []

    payload = serialize_result(
        Model(),
        alias="fit",
        runtime_name="tracepad_result_2",
        turn_id="turn-2",
        turn_number="2",
    )

    assert payload["kind"] == "model"
    assert payload["capabilities"] == ["summary", "predict"]
    assert payload["coefficients"][1] == {"term": "price", "estimate": -0.5}
