"""ORM models. Importing this package registers every table on `Base.metadata`."""

from orbit_api.db.models.avatars import UserAvatarModel
from orbit_api.db.models.budgets import (
    FinanceBudgetAlertModel,
    FinanceBudgetModel,
    FinanceBudgetPeriodModel,
    FinanceGoalContributionModel,
    FinanceMonthlyPlanModel,
    FinanceSavingsGoalModel,
)
from orbit_api.db.models.calendar import (
    CalendarCategoryModel,
    CalendarEventAlertModel,
    CalendarEventExceptionModel,
    CalendarEventModel,
    CalendarEventNoteModel,
    CalendarEventTaskModel,
    CalendarPreferencesModel,
)
from orbit_api.db.models.commitments import (
    FinanceLoanInstallmentModel,
    FinanceLoanModel,
    FinanceRecurringOccurrenceModel,
    FinanceRecurringPaymentModel,
)
from orbit_api.db.models.dashboard import DashboardLayoutModel
from orbit_api.db.models.finance import (
    FinanceAccountModel,
    FinanceCategoryModel,
    FinanceTransactionModel,
)
from orbit_api.db.models.investments import (
    FinanceAssetModel,
    FinanceAssetValuationModel,
    FinanceDepositModel,
    FinanceHoldingModel,
    FinanceHoldingPriceModel,
    FinanceInvestmentAccountModel,
    FinanceInvestmentTransactionModel,
    FinanceNetWorthSnapshotModel,
    FinanceSipPlanModel,
)
from orbit_api.db.models.notes import (
    NoteAttachmentModel,
    NoteFolderModel,
    NoteLinkModel,
    NoteModel,
    NoteTagAssignmentModel,
    NoteTagModel,
    NoteTaskLinkModel,
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
    "CalendarCategoryModel",
    "CalendarEventAlertModel",
    "CalendarEventExceptionModel",
    "CalendarEventModel",
    "CalendarEventNoteModel",
    "CalendarEventTaskModel",
    "CalendarPreferencesModel",
    "DashboardLayoutModel",
    "FinanceAccountModel",
    "FinanceAssetModel",
    "FinanceAssetValuationModel",
    "FinanceBudgetAlertModel",
    "FinanceBudgetModel",
    "FinanceBudgetPeriodModel",
    "FinanceCategoryModel",
    "FinanceDepositModel",
    "FinanceGoalContributionModel",
    "FinanceHoldingModel",
    "FinanceHoldingPriceModel",
    "FinanceInvestmentAccountModel",
    "FinanceInvestmentTransactionModel",
    "FinanceLoanInstallmentModel",
    "FinanceLoanModel",
    "FinanceMonthlyPlanModel",
    "FinanceNetWorthSnapshotModel",
    "FinanceRecurringOccurrenceModel",
    "FinanceRecurringPaymentModel",
    "FinanceSavingsGoalModel",
    "FinanceSipPlanModel",
    "FinanceTransactionModel",
    "LocalCredentialModel",
    "LocalSessionModel",
    "NoteAttachmentModel",
    "NoteFolderModel",
    "NoteLinkModel",
    "NoteModel",
    "NoteTagAssignmentModel",
    "NoteTagModel",
    "NoteTaskLinkModel",
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
