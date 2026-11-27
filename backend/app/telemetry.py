"""Buffers telemetry frames so that 10 to 20 Hz per drone does not mean one write per frame."""

import asyncio
import contextlib
import time

from app.db.repo import Repo


class TelemetryHub:
    def __init__(self, repo: Repo, flush_interval_s: float):
        self.repo, self.flush_interval_s = repo, flush_interval_s
        self._buffers: dict[str, list[dict]] = {}
        self._flushed_at: dict[str, float] = {}
        self._open: dict[str, int] = {}
        self._drained: dict[str, asyncio.Event] = {}
        self._sealed: set[str] = set()

    def ingest(self, run_id: str, frame: dict) -> bool:
        """Takes one sample. False when the run is already finished (the frame is dropped)."""
        if run_id in self._sealed:
            return False
        self._buffers.setdefault(run_id, []).append(frame)
        last = self._flushed_at.setdefault(run_id, time.monotonic())
        if time.monotonic() - last >= self.flush_interval_s:
            self.flush(run_id)
        return True

    def flush(self, run_id: str) -> None:
        frames = self._buffers.pop(run_id, None)
        self._flushed_at[run_id] = time.monotonic()
        if frames:
            self.repo.add_entries(run_id, frames)

    def flush_idle(self) -> None:
        """Stores the frames of runs that have not flushed for two intervals.

        A drone that keeps sending flushes itself, one run at a time; writing every run at
        once would stall all of them together.
        """
        limit = time.monotonic() - 2 * self.flush_interval_s
        for run_id in list(self._buffers):
            if self._flushed_at.get(run_id, 0) <= limit:
                self.flush(run_id)

    def flush_all(self) -> None:
        for run_id in list(self._buffers):
            self.flush(run_id)

    def seal(self, run_id: str) -> None:
        """The run is finished: nothing more is stored for it."""
        self._sealed.add(run_id)
        self._buffers.pop(run_id, None)

    def opened(self, run_id: str) -> None:
        self._open[run_id] = self._open.get(run_id, 0) + 1
        self._drained.setdefault(run_id, asyncio.Event()).clear()

    def closed(self, run_id: str) -> None:
        self._open[run_id] -= 1
        if self._open[run_id] == 0:
            self._drained[run_id].set()
        self.flush(run_id)

    async def wait_closed(self, run_id: str, timeout: float) -> None:
        """Waits (at most `timeout` seconds) until the run's sockets have delivered everything."""
        if self._open.get(run_id):
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._drained[run_id].wait(), timeout)
