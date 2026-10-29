"""Storage location models."""

from pydantic import BaseModel, Field

from orbit_api.config import StorageMode


class StorageLocationResponse(BaseModel):
    """Where this installation keeps its data, for signed-in users."""

    storage_mode: StorageMode
    database_path: str | None = Field(
        description="The SQLite file on the API's machine. Only in local mode, outside production."
    )
    can_reveal: bool = Field(
        description="Whether the API can open the database's folder in the file manager."
    )
