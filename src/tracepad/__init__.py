"""Tracepad JupyterLab extension."""

from .runtime import present

__version__ = "0.3.10"
__all__ = ["present"]


def _jupyter_server_extension_points():
    return [{"module": "tracepad.server"}]
