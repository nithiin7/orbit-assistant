"""ORM models. Importing this package registers every table on `Base.metadata`."""

from orbit_api.db.models.avatars import UserAvatarModel
from orbit_api.db.models.dashboard import DashboardLayoutModel
from orbit_api.db.models.shopping import ShoppingItemModel, ShoppingListModel
from orbit_api.db.models.tasks import TaskModel
from orbit_api.db.models.users import LocalCredentialModel, LocalSessionModel, UserModel
from orbit_api.db.models.workspaces import WorkspaceModel

__all__ = [
    "DashboardLayoutModel",
    "LocalCredentialModel",
    "LocalSessionModel",
    "ShoppingItemModel",
    "ShoppingListModel",
    "TaskModel",
    "UserAvatarModel",
    "UserModel",
    "WorkspaceModel",
]
