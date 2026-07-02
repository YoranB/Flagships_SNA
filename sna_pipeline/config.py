import importlib.util
from pathlib import Path


def _load_config_module(name):
    path = Path(__file__).resolve().parent / "config" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"sna_pipeline._config_{name}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_settings = _load_config_module("settings")
_institutions = _load_config_module("institutions")
_selected_flagships = _load_config_module("selected_flagships")

for _module in (_settings, _institutions, _selected_flagships):
    for _name in dir(_module):
        if _name.isupper():
            globals()[_name] = getattr(_module, _name)

__all__ = [name for name in globals() if name.isupper()]
