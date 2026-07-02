import pandas as pd

_ORIGINAL_SERIES_REPLACE = pd.Series.replace


def _series_replace_compat(self, to_replace=None, value=None, *args, **kwargs):
    if to_replace == "" and isinstance(value, pd.Series):
        return self.where(self != "", value)
    return _ORIGINAL_SERIES_REPLACE(self, to_replace=to_replace, value=value, *args, **kwargs)


pd.Series.replace = _series_replace_compat
