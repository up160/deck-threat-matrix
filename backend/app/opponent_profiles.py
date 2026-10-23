import json

from .tagger import CONFIG


def load_profiles() -> dict:
    return json.loads((CONFIG / "profiles.json").read_text())
