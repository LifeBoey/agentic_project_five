"""Settings for the Role 1 research pipeline: models, components, LLM chain, paths."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "research" / "raw"
CACHE_DIR = ROOT / "research" / "cache"
LINKS_PATH = ROOT / "data" / "links.json"
COVERAGE_PATH = ROOT / "research" / "coverage.md"

DRONE_MODELS = [
    {"name": "Skydio X10", "maker": "Skydio"},
    {"name": "Parrot Anafi USA", "maker": "Parrot"},
    {"name": "Teal 2", "maker": "Teal Drones (Red Cat Holdings)"},
    {"name": "DJI Mavic 3 Enterprise", "maker": "DJI"},
]

# One research job per drone model x research category.
# `component` is what ends up in links.json; `parts` lists the (part, tier) pairs
# this job may return. part=None means the component itself.
RESEARCH_CATEGORIES = [
    {
        "key": "motors",
        "component": "motors",
        "parts": [(None, 1)],
        "guidance": "Tier 1: the company that makes the brushless propulsion motors used in the drone.",
    },
    {
        "key": "magnets",
        "component": "motors",
        "parts": [("Magnets", 2), ("Rare-earth material", 3)],
        "guidance": (
            "Tier 2: the maker of the permanent magnets (usually NdFeB) inside the drone's motors. "
            "Tier 3: the producer of the rare-earth material (neodymium/praseodymium/dysprosium) "
            "used in those magnets."
        ),
    },
    {
        "key": "battery_cells",
        "component": "battery cells",
        "parts": [(None, 1), ("Cathode material", 2), ("Battery raw material", 3)],
        "guidance": (
            "Tier 1: the maker of the lithium-ion/LiPo cells in the drone's battery pack. "
            "Tier 2: the cathode (or anode) material supplier for those cells. "
            "Tier 3: the lithium/cobalt/graphite raw material producer."
        ),
    },
    {
        "key": "flight_controller_chip",
        "component": "flight controller chip",
        "parts": [(None, 1), ("Chip fabrication", 2)],
        "guidance": (
            "Tier 1: the company whose processor/SoC runs the drone's flight control or autonomy "
            "(e.g. the chip vendor). Tier 2: the foundry that fabricates that chip."
        ),
    },
    {
        "key": "camera_sensor",
        "component": "camera sensor",
        "parts": [(None, 1), ("Sensor fabrication", 2)],
        "guidance": (
            "Tier 1: the maker of the image sensor(s) in the drone's camera (visible and/or thermal). "
            "Tier 2: where that sensor is fabricated, if different."
        ),
    },
    {
        "key": "radio",
        "component": "radio",
        "parts": [(None, 1), ("Radio chip", 2)],
        "guidance": (
            "Tier 1: the maker of the drone's datalink/radio module. "
            "Tier 2: the maker of the RF/radio chipset inside that module."
        ),
    },
]

# Spelling variants the automatic folding misses (different first word). Variant -> spelling used in links.json.
SUPPLIER_ALIASES = {
    "SZ DJI Technology Co., Ltd.": "DJI",
    "FLIR Systems": "Teledyne FLIR",
}

COMPONENTS = sorted({c["component"] for c in RESEARCH_CATEGORIES})
# Sub-tier categories researched on their own (magnets): each gets its own unmapped record
# when nothing is verified, so the gap stays visible even if the parent component is mapped.
REQUIRED_PARTS = [(c["component"], c["parts"][0][0], c["parts"][0][1])
                  for c in RESEARCH_CATEGORIES if c["parts"][0][0] is not None]

# OpenCode gateway (OpenAI-compatible). Tried in order; a model that errors is skipped.
OPENCODE_BASE_URL = "https://opencode.ai/inference/openai/v1"
MODEL_CHAIN = ["deepseek-v4.1-flash", "glm-5.3-flash", "claude-sonnet-5-5"]
# USD per 1M tokens (input, output). Only used when the gateway reports no cost.
MODEL_PRICES = {
    "deepseek-v4.1-flash": (0.30, 1.20),
    "glm-5.3-flash": (0.15, 0.50),
    "claude-sonnet-5-5": (2.00, 10.00),
}

DEFAULT_BUDGET_USD = 5.0
MAX_SOURCES_PER_PART = 3
RESEARCH_MAX_TURNS = 12
PAGE_CHARS_FOR_VERIFIER = 24000
WORKERS = 6
