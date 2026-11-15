"""Voice preferences, per person. Audio is never stored: transcripts are saved as ordinary
assistant messages (`ai_messages.input_mode = 'voice'`).

Choices that belong to one device (microphone, speaker, volume, a browser voice) stay in that
browser; these follow the person.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now


class VoiceSettingsModel(Base):
    """How the person talks to Orbit: which engine hears them (`browser` speech recognition or
    one of their AI providers' transcription), which speaks back, languages, turn-taking, and how
    long spoken conversations are kept."""

    __tablename__ = "voice_settings"
    __table_args__ = (
        CheckConstraint("stt_engine IN ('browser', 'provider')", name="stt_engine"),
        CheckConstraint("tts_engine IN ('browser', 'provider')", name="tts_engine"),
        CheckConstraint("listening_mode IN ('continuous', 'push_to_talk')", name="listening_mode"),
        CheckConstraint("silence_ms BETWEEN 300 AND 5000", name="silence_ms"),
        CheckConstraint("sensitivity BETWEEN 1 AND 10", name="sensitivity"),
        CheckConstraint("speaking_rate BETWEEN 50 AND 200", name="speaking_rate"),
        CheckConstraint(
            "history_days IS NULL OR history_days BETWEEN 1 AND 3650", name="history_days"
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    stt_engine: Mapped[str] = mapped_column(String(16))
    stt_provider_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("ai_providers.id", ondelete="SET NULL")
    )
    stt_model: Mapped[str | None] = mapped_column(String(200))
    tts_engine: Mapped[str] = mapped_column(String(16))
    tts_provider_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("ai_providers.id", ondelete="SET NULL")
    )
    tts_model: Mapped[str | None] = mapped_column(String(200))
    tts_voice: Mapped[str | None] = mapped_column(String(100))
    recognition_language: Mapped[str] = mapped_column(String(35))
    response_language: Mapped[str | None] = mapped_column(String(35))
    listening_mode: Mapped[str] = mapped_column(String(16))
    silence_ms: Mapped[int] = mapped_column(Integer)
    sensitivity: Mapped[int] = mapped_column(Integer)
    auto_speak: Mapped[bool] = mapped_column(Boolean)
    speaking_rate: Mapped[int] = mapped_column(Integer)
    history_days: Mapped[int | None] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
