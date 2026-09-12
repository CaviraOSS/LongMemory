#      __                      __  ___
#     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
#    / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
#   / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
#  /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
#                     /____/                                 /____/
#
#  cavira oss (c) 2026  -  nullure (c) 2026
#  ----------------------------------------------------------
#  file  : packages/longmemory-py/src/longmemory/__init__.py
#  usage : exposes the public LongMemory Python SDK

from .client import AsyncLongMemory, LongMemory
from .errors import LongMemoryConnectionError, LongMemoryError

Client = LongMemory
Memory = LongMemory
__version__ = "1.0.0"

__all__ = [
    "AsyncLongMemory",
    "Client",
    "LongMemory",
    "LongMemoryConnectionError",
    "LongMemoryError",
    "Memory",
    "__version__",
]
