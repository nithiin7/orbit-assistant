"""Push notification models. Subscription endpoints and keys are accepted, never returned."""

from pydantic import BaseModel, ConfigDict, Field

from orbit_api.services.push.models import PushStatus


class PushStatusResponse(BaseModel):
    available: bool = Field(description="Whether this server can send push notifications.")
    public_key: str | None = Field(description="The key browsers subscribe with.")
    reminders: bool = Field(description="Send a notification when a reminder is due.")
    briefing: bool = Field(description="Send a notification when the daily briefing is ready.")
    show_details: bool = Field(description="Include a reminder's title and message.")
    devices: int = Field(description="How many devices have push turned on.")

    @classmethod
    def of(cls, status: PushStatus) -> "PushStatusResponse":
        return cls(
            available=status.public_key is not None,
            public_key=status.public_key,
            reminders=status.preferences.reminders,
            briefing=status.preferences.briefing,
            show_details=status.preferences.show_details,
            devices=status.devices,
        )


class UpdatePushPreferencesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reminders: bool
    briefing: bool
    show_details: bool


class PushSubscriptionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    endpoint: str = Field(min_length=1, max_length=2048)
    p256dh: str = Field(min_length=1, max_length=128)
    auth: str = Field(min_length=1, max_length=64)


class RemovePushSubscriptionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    endpoint: str = Field(min_length=1, max_length=2048)


class PushTestResponse(BaseModel):
    sent: int = Field(description="How many devices' push services accepted the notification.")
