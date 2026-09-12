#      __                      __  ___
#     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
#    / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
#   / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
#  /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
#                     /____/                                 /____/
#
#  cavira oss (c) 2026  -  nullure (c) 2026
#  ----------------------------------------------------------
#  file  : packages/openmemory-py/src/openmemory/client.py
#  usage : forwards legacy client imports to the LongMemory Python SDK

from longmemory import AsyncLongMemory, Client, LongMemory, Memory

__all__ = ["AsyncLongMemory", "Client", "LongMemory", "Memory"]
