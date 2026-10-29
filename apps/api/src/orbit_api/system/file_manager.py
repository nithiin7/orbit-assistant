"""Opening the operating system's file manager on the API's own machine."""

import subprocess
import sys
from pathlib import Path
from typing import Protocol


class FileManagerUnavailableError(Exception):
    """No file manager could be launched, for example on a headless server."""


class FileRevealer(Protocol):
    def reveal(self, path: Path) -> None:
        """Show `path` in the file manager: selected if it exists, else its folder."""
        ...


class SystemFileRevealer:
    """Launches Finder, File Explorer, or the desktop's default file manager.

    The command is a fixed argument list (no shell) and `path` always comes from the server's
    settings, never from a request.
    """

    def reveal(self, path: Path) -> None:
        exists = path.exists()
        if sys.platform == "darwin":
            command = ["open", "-R", str(path)] if exists else ["open", str(path.parent)]
        elif sys.platform == "win32":
            command = ["explorer", f"/select,{path}"] if exists else ["explorer", str(path.parent)]
        else:
            command = ["xdg-open", str(path.parent)]
        try:
            # Fire and forget: the file manager outlives the request and its output is unused.
            subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        except OSError as exc:
            raise FileManagerUnavailableError from exc
