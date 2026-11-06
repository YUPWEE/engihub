"""Run `cd /app/backend && python seed.py` — seeds branches + sample courses if the DB is empty."""

import asyncio

from lib.db import ensure_indexes
from lib.seed import seed_if_empty


async def main() -> None:
    await ensure_indexes()
    await seed_if_empty()
    print("seed done")


if __name__ == "__main__":
    asyncio.run(main())
