"""ORM models. Importing this package registers every table on `Base.metadata`."""

from orbit_api.db.models.avatars import UserAvatarModel
from orbit_api.db.models.dashboard import DashboardLayoutModel
from orbit_api.db.models.finance import (
    FinanceAccountModel,
    FinanceCategoryModel,
    FinanceTransactionModel,
)
from orbit_api.db.models.reminders import (
    NotificationModel,
    ReminderModel,
    ReminderOccurrenceModel,
)
from orbit_api.db.models.shopping import ShoppingItemModel, ShoppingListModel
from orbit_api.db.models.tasks import TaskModel
from orbit_api.db.models.users import LocalCredentialModel, LocalSessionModel, UserModel
from orbit_api.db.models.workspaces import WorkspaceModel

__all__ = [
    "DashboardLayoutModel",
    "FinanceAccountModel",
    "FinanceCategoryModel",
    "FinanceTransactionModel",
    "LocalCredentialModel",
    "LocalSessionModel",
    "NotificationModel",
    "ReminderModel",
    "ReminderOccurrenceModel",
    "ShoppingItemModel",
    "ShoppingListModel",
    "TaskModel",
    "UserAvatarModel",
    "UserModel",
    "WorkspaceModel",
]
