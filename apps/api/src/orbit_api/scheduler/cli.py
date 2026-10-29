"""`orbit-worker`: run the reminder worker on its own, or inspect and recover its queue.

    uv run orbit-worker               # poll until Ctrl+C or SIGTERM
    uv run orbit-worker --once        # process what is due now, then exit
    uv run orbit-worker status        # occurrences by status
    uv run orbit-worker retry-failed  # make failed occurrences pending again

It uses the same `ORBIT_*` settings and database as the API, and refuses to start if that
database is unreachable or not migrated.
"""

import argparse
import asyncio
import contextlib
import logging
import signal

from orbit_api.config import get_settings
from orbit_api.db.database import open_database
from orbit_api.scheduler.worker import ReminderWorker


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="orbit-worker", description="Deliver due reminders, or inspect the queue."
    )
    parser.add_argument(
        "command", nargs="?", default="run", choices=("run", "status", "retry-failed")
    )
    parser.add_argument("--once", action="store_true", help="run: poll once, then exit")
    args = parser.parse_args()

    settings = get_settings()
    logging.basicConfig(
        level=settings.log_level.upper(), format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    asyncio.run(_run(args.command, once=args.once, poll_interval=settings.scheduler_poll_seconds))


async def _run(command: str, *, once: bool, poll_interval: float) -> None:
    database = await open_database(get_settings())
    worker = ReminderWorker(database)
    try:
        match command:
            case "status":
                counts = await worker.status()
                for name, count in counts.items():
                    print(f"{name}: {count}")
                if not counts:
                    print("No reminder occurrences.")
            case "retry-failed":
                print(f"Made {await worker.retry_failed()} failed occurrence(s) pending again.")
            case _ if once:
                report = await worker.run_once()
                print(f"Claimed {report.claimed}: {dict(report.results)}")
            case _:
                stop = asyncio.Event()
                loop = asyncio.get_running_loop()
                for sig in (signal.SIGINT, signal.SIGTERM):
                    # Windows has no signal handlers: Ctrl+C raises KeyboardInterrupt instead.
                    with contextlib.suppress(NotImplementedError):
                        loop.add_signal_handler(sig, stop.set)
                await worker.run(stop, poll_interval)
    finally:
        await database.dispose()


if __name__ == "__main__":
    main()
