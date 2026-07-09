"""Tracepad JupyterLab extension."""

__version__ = "0.1.0"


def _jupyter_server_extension_points():
    return [{"module": "tracepad.server"}]
