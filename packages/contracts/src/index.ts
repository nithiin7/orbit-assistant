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
export type InvestmentAccount = Schemas["InvestmentAccountResponse"];
export type InvestmentAccountKind = InvestmentAccount["kind"];
export type InvestmentAccountList = Schemas["InvestmentAccountListResponse"];
export type CreateInvestmentAccountRequest = Schemas["CreateInvestmentAccountRequest"];
export type UpdateInvestmentAccountRequest = Schemas["UpdateInvestmentAccountRequest"];
export type Holding = Schemas["HoldingResponse"];
export type HoldingKind = Holding["kind"];
export type Freshness = Holding["freshness"];
export type HoldingList = Schemas["HoldingListResponse"];
export type CreateHoldingRequest = Schemas["CreateHoldingRequest"];
export type UpdateHoldingRequest = Schemas["UpdateHoldingRequest"];
export type HoldingPrice = Schemas["PriceResponse"];
export type HoldingPriceList = Schemas["PriceListResponse"];
export type RecordPriceRequest = Schemas["RecordPriceRequest"];
export type InvestmentTransaction = Schemas["InvestmentTransactionResponse"];
export type InvestmentTransactionType = InvestmentTransaction["type"];
export type Settlement = InvestmentTransaction["settlement"];
export type InvestmentTransactionList = Schemas["InvestmentTransactionListResponse"];
export type RecordInvestmentTransactionRequest = Schemas["RecordInvestmentTransactionRequest"];
/** Filters accepted when listing investment activity. */
export type InvestmentTransactionListQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/finance/investment-transactions"]["get"]["parameters"]["query"]
>;
export type SipPlan = Schemas["SipPlanResponse"];
export type SipState = SipPlan["state"];
export type SipPlanList = Schemas["SipPlanListResponse"];
export type CreateSipPlanRequest = Schemas["CreateSipPlanRequest"];
export type UpdateSipPlanRequest = Schemas["UpdateSipPlanRequest"];
export type RecordSipInstallmentRequest = Schemas["RecordSipInstallmentRequest"];
export type Deposit = Schemas["DepositResponse"];
export type DepositKind = Deposit["kind"];
export type Compounding = Deposit["compounding"];
export type ValueSource = Deposit["value_source"];
export type DepositList = Schemas["DepositListResponse"];
export type CreateDepositRequest = Schemas["CreateDepositRequest"];
export type UpdateDepositRequest = Schemas["UpdateDepositRequest"];
export type DepositContributionRequest = Schemas["DepositContributionRequest"];
export type DepositValueRequest = Schemas["DepositValueRequest"];
export type CloseDepositRequest = Schemas["CloseDepositRequest"];
export type Portfolio = Schemas["PortfolioResponse"];
export type PortfolioSlice = Schemas["SliceResponse"];
export type PortfolioQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/finance/portfolio"]["get"]["parameters"]["query"]
>;
export type Asset = Schemas["AssetResponse"];
export type AssetCategory = Asset["category"];
export type AssetList = Schemas["AssetListResponse"];
export type CreateAssetRequest = Schemas["CreateAssetRequest"];
export type UpdateAssetRequest = Schemas["UpdateAssetRequest"];
export type AssetValuation = Schemas["AssetValuationResponse"];
export type AssetValuationList = Schemas["AssetValuationListResponse"];
export type RecordValuationRequest = Schemas["RecordValuationRequest"];
export type NetWorth = Schemas["NetWorthResponse"];
export type NetWorthItem = Schemas["NetWorthItemResponse"];
export type NetWorthGroup = NetWorthItem["group"];
export type NetWorthGroupTotal = Schemas["GroupTotalResponse"];
export type NetWorthSnapshot = Schemas["SnapshotResponse"];
export type NetWorthSnapshotList = Schemas["SnapshotListResponse"];
export type TakeSnapshotRequest = Schemas["TakeSnapshotRequest"];
export type NetWorthQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/finance/net-worth"]["get"]["parameters"]["query"]
>;
export type Budget = Schemas["BudgetResponse"];
export type BudgetPeriod = Schemas["BudgetPeriodResponse"];
export type BudgetScope = Budget["scope"];
export type BudgetPeriodType = Budget["period"];
export type BudgetStatus = Budget["status"];
export type RolloverMode = Budget["rollover"];
export type UtilizationStatus = BudgetPeriod["status"];
export type BudgetList = Schemas["BudgetListResponse"];
export type BudgetDetail = Schemas["BudgetDetailResponse"];
export type BudgetMonth = Schemas["BudgetMonthResponse"];
export type BudgetCategoryMonth = Schemas["CategoryMonthResponse"];
export type BudgetHistory = Schemas["BudgetHistoryResponse"];
export type CreateBudgetRequest = Schemas["CreateBudgetRequest"];
export type UpdateBudgetRequest = Schemas["UpdateBudgetRequest"];
export type CopyBudgetsRequest = Schemas["CopyBudgetsRequest"];
export type CopyBudgetsResult = Schemas["CopyBudgetsResponse"];
export type BudgetMonthQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/finance/budgets/overview"]["get"]["parameters"]["query"]
>;
export type BudgetHistoryQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/finance/budgets/history"]["get"]["parameters"]["query"]
>;
export type SavingsGoal = Schemas["GoalResponse"];
export type GoalCategory = SavingsGoal["category"];
export type GoalPriority = SavingsGoal["priority"];
export type GoalState = SavingsGoal["state"];
export type SavingsGoalList = Schemas["GoalListResponse"];
export type CreateGoalRequest = Schemas["CreateGoalRequest"];
export type UpdateGoalRequest = Schemas["UpdateGoalRequest"];
export type GoalContribution = Schemas["ContributionResponse"];
export type GoalContributionList = Schemas["ContributionListResponse"];
export type CreateContributionRequest = Schemas["CreateContributionRequest"];
export type ContributionType = GoalContribution["type"];
export type ContributionMode = NonNullable<CreateContributionRequest["mode"]>;
export type MonthPlan = Schemas["PlanResponse"];
export type PlanLine = Schemas["LineResponse"];
export type PlanQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/finance/plan"]["get"]["parameters"]["query"]
>;
export type SetIncomeRequest = Schemas["SetIncomeRequest"];
export type MonthlyIncomePlan = Schemas["MonthlyPlanResponse"];
export type Note = Schemas["NoteResponse"];
export type NoteSummary = Schemas["NoteSummaryResponse"];
export type NoteList = Schemas["NoteListResponse"];
export type NoteType = Note["note_type"];
export type NoteContent = Note["content"];
export type NoteTag = Schemas["TagRef"];
export type NoteCounts = Schemas["NoteCountsResponse"];
export type CreateNoteRequest = Schemas["CreateNoteRequest"];
export type UpdateNoteRequest = Schemas["UpdateNoteRequest"];
export type NoteRef = Schemas["NoteRefResponse"];
export type NoteConnections = Schemas["NoteConnectionsResponse"];
export type NoteTagList = Schemas["NoteTagsResponse"];
/** Filters, search, sorting, and paging accepted when listing notes. */
export type NoteListQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/notes"]["get"]["parameters"]["query"]
>;
export type NoteSort = NonNullable<NoteListQuery["sort"]>;
export type NoteFolder = Schemas["FolderResponse"];
export type NoteFolderList = Schemas["FolderListResponse"];
export type CreateNoteFolderRequest = Schemas["CreateFolderRequest"];
export type UpdateNoteFolderRequest = Schemas["UpdateFolderRequest"];
export type FolderDeleteMode = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/note-folders/{folder_id}"]["delete"]["parameters"]["query"]
>["notes"];
export type Tag = Schemas["TagResponse"];
export type TagList = Schemas["TagListResponse"];
export type NoteAttachment = Schemas["AttachmentResponse"];
export type NoteAttachmentList = Schemas["AttachmentListResponse"];
export type CalendarCategory = Schemas["CalendarCategoryResponse"];
export type CalendarCategoryList = Schemas["CalendarCategoryListResponse"];
export type CalendarCategoryColor = CalendarCategory["color"];
export type CreateCalendarCategoryRequest = Schemas["CreateCalendarCategoryRequest"];
export type UpdateCalendarCategoryRequest = Schemas["UpdateCalendarCategoryRequest"];
export type CalendarEvent = Schemas["EventDetailResponse"];
export type CalendarEventSummary = Schemas["EventResponse"];
export type CalendarEventList = Schemas["EventListResponse"];
export type CalendarEventStatus = CalendarEvent["status"];
export type CalendarOccurrence = Schemas["OccurrenceResponse"];
export type CalendarLinkedNote = Schemas["LinkedNoteResponse"];
export type EventRecurrenceRule = Schemas["RecurrenceRuleModel"];
export type EventRecurrenceFrequency = EventRecurrenceRule["frequency"];
export type CreateCalendarEventRequest = Schemas["CreateEventRequest"];
export type UpdateCalendarEventRequest = Schemas["UpdateEventRequest"];
export type UpdateOccurrenceRequest = Schemas["UpdateOccurrenceRequest"];
export type CalendarEditScope = NonNullable<UpdateOccurrenceRequest["scope"]>;
export type CreateEventNoteRequest = Schemas["CreateEventNoteRequest"];
export type CalendarRange = Schemas["CalendarRangeResponse"];
export type CalendarAgenda = Schemas["AgendaResponse"];
export type CalendarAgendaItem = Schemas["AgendaItemResponse"];
export type CalendarPreferences = Schemas["CalendarPreferencesResponse"];
export type CalendarPreferencesRequest = Schemas["CalendarPreferencesModel"];
export type CalendarView = CalendarPreferences["default_view"];
/** The date range, viewer time zone, and task options accepted for a calendar range. */
export type CalendarRangeQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/calendar/range"]["get"]["parameters"]["query"]
>;
export type CalendarAgendaQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/calendar/agenda"]["get"]["parameters"]["query"]
>;
export type CalendarEventListQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/calendar/events"]["get"]["parameters"]["query"]
>;
