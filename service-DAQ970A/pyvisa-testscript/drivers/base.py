"""
Abstract base class for oscilloscope drivers.

To add support for a new scope
──────────────────────────────
1. Create  drivers/<your_scope>.py
2. Subclass ScopeDriver and implement every @abstractmethod
3. Register the class in drivers/__init__.py  REGISTRY
4. Set DRIVER_NAME = "<your_scope>" in config.py
"""

from abc import ABC, abstractmethod

import numpy as np


class ScopeDriver(ABC):

    # ── Metadata (override in every subclass) ─────────────────────────────────

    NAME: str = "Unknown Scope"
    N_CHANNELS: int = 4

    CHANNEL_COLORS: dict[str, str] = {
        "1": "#FFD700",
        "2": "#00E5FF",
        "3": "#FF00FF",
        "4": "#00FF88",
    }

    TIMEBASE_OPTIONS: list[tuple[float, str]] = []
    VSCALE_OPTIONS:   list[tuple[float, str]] = []

    # ── Connection ────────────────────────────────────────────────────────────

    @abstractmethod
    def setup(self, resource) -> None:
        """Configure the pyvisa resource immediately after open_resource()."""

    @abstractmethod
    def read_settings(self, resource) -> dict:
        """Query the scope and return a settings dict."""

    # ── Acquisition ───────────────────────────────────────────────────────────

    @abstractmethod
    def digitize(self, resource, channels: list[str]) -> None:
        """Trigger a single acquisition for the listed channel numbers."""

    @abstractmethod
    def set_waveform_source(self, resource, channel: str) -> None:
        """Select which channel's data will be returned by read_waveform()."""

    @abstractmethod
    def read_waveform(self, resource) -> tuple[np.ndarray, np.ndarray]:
        """Return (time_axis, voltage_axis) as numpy float64 arrays."""

    @abstractmethod
    def read_preamble(self, resource, channel: str) -> dict:
        """Set the waveform source to *channel* and query its scaling preamble."""

    @abstractmethod
    def read_waveform_data(self, resource) -> np.ndarray:
        """Read raw ADC integer samples for the current waveform source."""

    def scale_waveform(self, raw: np.ndarray, preamble: dict) -> tuple[np.ndarray, np.ndarray]:
        """Convert raw ADC samples to (time_s, voltage_v) using cached preamble dict."""
        t = (np.arange(len(raw)) - preamble["x_ref"]) * preamble["x_inc"] + preamble["x_orig"]
        v = (raw               - preamble["y_ref"]) * preamble["y_inc"] + preamble["y_orig"]
        return t, v

    @abstractmethod
    def resume(self, resource) -> None:
        """Put the scope back into free-running (continuous) acquisition."""

    # ── Settings control ──────────────────────────────────────────────────────

    @abstractmethod
    def set_timebase(self, resource, value: float) -> None:
        """Set horizontal scale in seconds-per-division."""

    @abstractmethod
    def set_channel_scale(self, resource, channel: str, scale: float) -> None:
        """Set vertical scale in volts-per-division for the given channel."""

    @abstractmethod
    def set_channel_display(self, resource, channel: str, enabled: bool) -> None:
        """Show or hide a channel on the scope's own display."""

    @abstractmethod
    def set_trigger_source(self, resource, source: str) -> None:
        """Set the trigger source."""

    @abstractmethod
    def set_trigger_slope(self, resource, slope: str) -> None:
        """Set the trigger slope."""

    @abstractmethod
    def set_trigger_level(self, resource, level: float) -> None:
        """Set the trigger level in volts."""

    # ── Acquisition mode ──────────────────────────────────────────────────────

    @abstractmethod
    def stop_acquisition(self, resource) -> None:
        """Halt the scope's continuous acquisition."""

    @abstractmethod
    def run_acquisition(self, resource) -> None:
        """Start or resume continuous acquisition."""

    @abstractmethod
    def single_acquisition(self, resource) -> None:
        """Capture exactly one trigger event then halt."""

    # ── Position / offset ─────────────────────────────────────────────────────

    @abstractmethod
    def set_time_position(self, resource, value: float) -> None:
        """Shift the waveform horizontally."""

    @abstractmethod
    def set_channel_offset(self, resource, channel: str, offset: float) -> None:
        """Shift a channel's waveform vertically."""

    @abstractmethod
    def set_channel_coupling(self, resource, channel: str, coupling: str) -> None:
        """Set channel input coupling: 'DC', 'AC', or 'GND'."""

    @abstractmethod
    def set_channel_probe(self, resource, channel: str, ratio: float) -> None:
        """Set probe attenuation ratio."""

    @abstractmethod
    def set_channel_bwlimit(self, resource, channel: str, bwlimit: bool) -> None:
        """Enable or disable the 20 MHz bandwidth limit filter."""

    @abstractmethod
    def set_channel_invert(self, resource, channel: str, invert: bool) -> None:
        """Invert the channel waveform."""

    # ── Trigger mode ──────────────────────────────────────────────────────────

    @abstractmethod
    def set_trigger_mode(self, resource, mode: str) -> None:
        """Set trigger sweep mode: 'AUTO' or 'NORMal'."""

    # ── Acquisition type ──────────────────────────────────────────────────────

    @abstractmethod
    def set_acquire_type(self, resource, acq_type: str) -> None:
        """Set acquisition type."""

    @abstractmethod
    def set_acquire_count(self, resource, count: int) -> None:
        """Set the number of averages."""

    # ── Measurements ──────────────────────────────────────────────────────────

    @abstractmethod
    def get_measurement(self, resource, mtype: str, source: str) -> float | None:
        """Query a single automatic measurement."""
