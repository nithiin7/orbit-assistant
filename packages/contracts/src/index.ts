/**
 * Types for the Orbit API, generated from the FastAPI OpenAPI schema.
 * Do not edit `schema.ts` by hand; change the Pydantic models and run `pnpm contracts:generate`.
 */
import type { components, paths } from "./schema";

export type { components, operations, paths } from "./schema";

type Schemas = components["schemas"];

export type HealthResponse = Schemas["HealthResponse"];
export type DatabaseHealthResponse = Schemas["DatabaseHealthResponse"];
export type AuthConfig = Schemas["LocalAuthConfig"] | Schemas["SupabaseAuthConfig"];
export type LocalAuthConfig = Schemas["LocalAuthConfig"];
export type SupabaseAuthConfig = Schemas["SupabaseAuthConfig"];
export type LocalSignUpRequest = Schemas["LocalSignUpRequest"];
export type LocalSignInRequest = Schemas["LocalSignInRequest"];
export type LocalSessionResponse = Schemas["LocalSessionResponse"];
export type UserProfile = Schemas["UserProfile"];
export type UpdateProfileRequest = Schemas["UpdateProfileRequest"];
export type Workspace = Schemas["WorkspaceResponse"];
export type WorkspaceList = Schemas["WorkspaceListResponse"];
export type CreateWorkspaceRequest = Schemas["CreateWorkspaceRequest"];
export type UpdateWorkspaceRequest = Schemas["UpdateWorkspaceRequest"];
export type StorageLocation = Schemas["StorageLocationResponse"];
export type Task = Schemas["TaskResponse"];
export type TaskStatus = Task["status"];
export type TaskPriority = Task["priority"];
export type TaskList = Schemas["TaskListResponse"];
export type TaskSummary = Schemas["TaskSummaryResponse"];
export type CreateTaskRequest = Schemas["CreateTaskRequest"];
export type UpdateTaskRequest = Schemas["UpdateTaskRequest"];
/** Filters, sorting, and paging accepted when listing tasks. */
export type TaskListQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/tasks"]["get"]["parameters"]["query"]
>;
export type TaskSummaryQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/tasks/summary"]["get"]["parameters"]["query"]
>;
export type ShoppingList = Schemas["ShoppingListResponse"];
export type ShoppingListOverview = Schemas["ShoppingListOverviewResponse"];
export type ShoppingLists = Schemas["ShoppingListsResponse"];
export type ShoppingListRequest = Schemas["ShoppingListRequest"];
export type ShoppingItem = Schemas["ShoppingItemResponse"];
export type ShoppingItemStatus = ShoppingItem["status"];
export type ShoppingItems = Schemas["ShoppingItemsResponse"];
export type CreateShoppingItemRequest = Schemas["CreateItemRequest"];
export type UpdateShoppingItemRequest = Schemas["UpdateItemRequest"];
export type BulkChangeResponse = Schemas["BulkChangeResponse"];
export type DashboardLayout = Schemas["DashboardLayoutResponse"];
export type DashboardLayoutRequest = Schemas["DashboardLayoutRequest"];
export type DashboardWidget = Schemas["DashboardWidgetModel"];
export type DashboardWidgetId = DashboardWidget["id"];
export type DashboardWidgetSize = DashboardWidget["size"];
export type Reminder = Schemas["ReminderResponse"];
export type ReminderStatus = Reminder["status"];
export type ReminderList = Schemas["ReminderListResponse"];
export type UpcomingReminders = Schemas["UpcomingRemindersResponse"];
export type Recurrence = Schemas["RecurrenceModel"];
export type RecurrenceFrequency = Recurrence["frequency"];
export type Weekday = NonNullable<Recurrence["weekdays"]>[number];
export type CreateReminderRequest = Schemas["CreateReminderRequest"];
export type UpdateReminderRequest = Schemas["UpdateReminderRequest"];
/** Filters and paging accepted when listing reminders. */
export type ReminderListQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/reminders"]["get"]["parameters"]["query"]
>;
export type UpcomingRemindersQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/reminders/upcoming"]["get"]["parameters"]["query"]
>;
export type Notification = Schemas["NotificationResponse"];
export type NotificationList = Schemas["NotificationListResponse"];
export type NotificationListQuery = NonNullable<
  paths["/api/v1/me/notifications"]["get"]["parameters"]["query"]
>;
export type UnreadNotificationCount = Schemas["UnreadCountResponse"];
export type MarkAllNotificationsReadResponse = Schemas["MarkAllReadResponse"];
export type FinanceAccount = Schemas["AccountResponse"];
export type FinanceAccountType = FinanceAccount["type"];
export type FinanceAccountClass = FinanceAccount["account_class"];
export type Currency = FinanceAccount["currency"];
export type FinanceAccountList = Schemas["AccountListResponse"];
export type BalanceTotals = Schemas["BalanceTotalsResponse"];
export type CreateFinanceAccountRequest = Schemas["CreateAccountRequest"];
export type UpdateFinanceAccountRequest = Schemas["UpdateAccountRequest"];
export type FinanceCategory = Schemas["CategoryResponse"];
export type FinanceCategoryType = FinanceCategory["type"];
export type FinanceCategoryList = Schemas["CategoryListResponse"];
export type CreateFinanceCategoryRequest = Schemas["CreateCategoryRequest"];
export type RenameFinanceCategoryRequest = Schemas["RenameCategoryRequest"];
export type FinanceTransaction = Schemas["TransactionResponse"];
export type FinanceTransactionType = FinanceTransaction["type"];
export type FinanceTransactionList = Schemas["TransactionListResponse"];
export type CreateFinanceTransactionRequest = Schemas["CreateTransactionRequest"];
export type UpdateFinanceTransactionRequest = Schemas["UpdateTransactionRequest"];
export type CreateTransferRequest = Schemas["CreateTransferRequest"];
/** Filters, sorting, and paging accepted when listing transactions. */
export type FinanceTransactionListQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/finance/transactions"]["get"]["parameters"]["query"]
>;
export type FinanceExportQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/finance/transactions/export"]["get"]["parameters"]["query"]
>;
export type FinanceReportQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/finance/summary"]["get"]["parameters"]["query"]
>;
export type FinanceTrendQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/finance/trend"]["get"]["parameters"]["query"]
>;
export type MonthlySummary = Schemas["MonthlySummaryResponse"];
export type MonthCashFlow = Schemas["MonthCashFlowResponse"];
export type FinanceTrend = Schemas["TrendResponse"];
export type CategorySpending = Schemas["CategorySpendingResponse"];
export type SpendingByCategory = Schemas["SpendingResponse"];
export type Loan = Schemas["LoanResponse"];
export type LoanType = Loan["loan_type"];
export type LoanStatus = Loan["status"];
export type InterestMethod = Loan["interest_method"];
export type EmiFrequency = Loan["emi_frequency"];
export type LoanList = Schemas["LoanListResponse"];
export type LoanDetail = Schemas["LoanDetailResponse"];
export type Installment = Schemas["InstallmentResponse"];
export type CreateLoanRequest = Schemas["CreateLoanRequest"];
export type UpdateLoanRequest = Schemas["UpdateLoanRequest"];
export type RescheduleLoanRequest = Schemas["RescheduleLoanRequest"];
export type UpdateInstallmentRequest = Schemas["UpdateInstallmentRequest"];
export type PayInstallmentRequest = Schemas["PayInstallmentRequest"];
export type ReminderSettings = Schemas["ReminderSettingsResponse"];
export type ReminderSettingsRequest = Schemas["ReminderSettingsRequest"];
export type RecurringPayment = Schemas["RecurringPaymentResponse"];
export type RecurringKind = RecurringPayment["kind"];
export type RecurringFrequency = RecurringPayment["frequency"];
export type RecurringStatus = RecurringPayment["status"];
export type RecurringPaymentList = Schemas["RecurringPaymentListResponse"];
export type CreateRecurringPaymentRequest = Schemas["CreateRecurringPaymentRequest"];
export type UpdateRecurringPaymentRequest = Schemas["UpdateRecurringPaymentRequest"];
export type RecordRecurringPaymentRequest = Schemas["RecordRecurringPaymentRequest"];
export type SettledOccurrence = Schemas["SettledOccurrenceResponse"];
export type SettledOccurrenceList = Schemas["SettledOccurrenceListResponse"];
export type PaymentItem = Schemas["PaymentItemResponse"];
export type PaymentStatus = PaymentItem["status"];
export type CommitmentKind = PaymentItem["kind"];
export type PaymentList = Schemas["PaymentListResponse"];
/** Filters accepted when listing upcoming and recent payments. */
export type PaymentListQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/finance/payments"]["get"]["parameters"]["query"]
>;
export type CommitmentSummary = Schemas["CommitmentSummaryResponse"];
export type CommitmentSummaryQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/finance/commitments/summary"]["get"]["parameters"]["query"]
>;
export type ReminderCommitment = Schemas["ReminderCommitmentResponse"];
