#      __                      __  ___
#     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
#    / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
#   / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
#  /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
#                     /____/                                 /____/
#
#  cavira oss (c) 2026  -  nullure (c) 2026
#  ----------------------------------------------------------
#  file  : packages/openmemory-py/src/openmemory/__init__.py
#  usage : forwards the legacy Python import namespace to LongMemory

from warnings import warn

from longmemory import (
    AsyncLongMemory,
    Client,
    LongMemory,
    LongMemoryConnectionError,
    LongMemoryError,
    Memory,
    __version__,
)

warn(
    "openmemory-py is deprecated; install longmemory-sdk and import longmemory",
    DeprecationWarning,
    stacklevel=2,
)

__all__ = [
    "AsyncLongMemory",
    "Client",
    "LongMemory",
    "LongMemoryConnectionError",
    "LongMemoryError",
    "Memory",
    "__version__",
]
