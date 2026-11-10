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
export type ChangePasswordRequest = Schemas["ChangePasswordRequest"];
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
/** A named, colored list a task can be on (Work, Personal, ...), with its open task count. */
export type TaskListDetail = Schemas["TaskListDetailResponse"];
export type TaskListColor = TaskListDetail["color"];
export type TaskLists = Schemas["TaskListsResponse"];
export type CreateTaskListRequest = Schemas["CreateTaskListRequest"];
export type UpdateTaskListRequest = Schemas["UpdateTaskListRequest"];
export type ShoppingList = Schemas["ShoppingListResponse"];
export type ShoppingListOverview = Schemas["ShoppingListOverviewResponse"];
export type ShoppingLists = Schemas["ShoppingListsResponse"];
export type ShoppingListRequest = Schemas["ShoppingListRequest"];
export type ShoppingItem = Schemas["ShoppingItemResponse"];
export type ShoppingItemStatus = ShoppingItem["status"];
export type ShoppingItems = Schemas["ShoppingItemsResponse"];
export type CreateShoppingItemRequest = Schemas["CreateItemRequest"];
export type UpdateShoppingItemRequest = Schemas["UpdateItemRequest"];

export type WatchItem = Schemas["WatchItemResponse"];
export type WatchKind = WatchItem["kind"];
export type WatchStatus = WatchItem["status"];
export type WatchProgress = Schemas["ProgressModel"];
export type WatchItems = Schemas["WatchItemsResponse"];
export type CreateWatchItemRequest = Schemas["CreateWatchItemRequest"];
export type UpdateWatchItemRequest = Schemas["UpdateWatchItemRequest"];
export type WatchlistLookup = Schemas["WatchlistLookupResponse"];
export type TitleMatch = Schemas["TitleMatchResponse"];
export type TitleMatches = Schemas["TitleMatchesResponse"];

export type Bookmark = Schemas["BookmarkResponse"];
export type BookmarkKind = Bookmark["kind"];
export type BookmarkStatus = Bookmark["status"];
export type Bookmarks = Schemas["BookmarksResponse"];
export type CreateBookmarkRequest = Schemas["CreateBookmarkRequest"];
export type UpdateBookmarkRequest = Schemas["UpdateBookmarkRequest"];
export type BookmarkCollection = Schemas["BookmarkCollectionResponse"];
export type BookmarkCollectionColor = BookmarkCollection["color"];
export type BookmarkCollections = Schemas["BookmarkCollectionsResponse"];
export type CreateBookmarkCollectionRequest = Schemas["CreateBookmarkCollectionRequest"];
export type Place = Schemas["PlaceResponse"];
export type PlaceStatus = Place["status"];
export type PlaceLocation = Schemas["PlaceLocation"];
export type Places = Schemas["PlacesResponse"];
export type CreatePlaceRequest = Schemas["CreatePlaceRequest"];
export type UpdatePlaceRequest = Schemas["UpdatePlaceRequest"];
export type PlaceMatch = Schemas["PlaceMatchResponse"];
export type PlaceMatches = Schemas["PlaceMatchesResponse"];
export type PlaceSettings = Schemas["PlaceSettingsResponse"];
export type UpdateBookmarkCollectionRequest = Schemas["UpdateBookmarkCollectionRequest"];
export type BookmarkSettings = Schemas["BookmarkSettingsResponse"];
export type BookmarkSettingsRequest = Schemas["BookmarkSettingsRequest"];
export type BulkChangeResponse = Schemas["BulkChangeResponse"];
export type DashboardLayout = Schemas["DashboardLayoutResponse"];
export type DashboardLayoutRequest = Schemas["DashboardLayoutRequest"];
export type DashboardWidget = Schemas["DashboardWidgetModel"];
export type DashboardWidgetId = DashboardWidget["id"];
export type DashboardWidgetSize = DashboardWidget["size"];
export type DashboardDensity = DashboardLayout["density"];
export type TodayOverview = Schemas["TodayOverviewResponse"];
export type TodayOverviewSection = TodayOverview["unavailable"][number];
export type TodayOverviewQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/dashboard/today"]["get"]["parameters"]["query"]
>;
export type OverviewTasks = Schemas["OverviewTasksResponse"];
export type OverviewEvents = Schemas["OverviewEventsResponse"];
export type OverviewReminders = Schemas["OverviewRemindersResponse"];
export type OverviewReminder = Schemas["OverviewReminderResponse"];
export type OverviewHabits = Schemas["OverviewHabitsResponse"];
export type OverviewDocuments = Schemas["OverviewDocumentsResponse"];
export type OverviewDocument = Schemas["OverviewDocumentResponse"];
export type OverviewPayments = Schemas["OverviewPaymentsResponse"];
export type OverviewPayment = Schemas["OverviewPaymentResponse"];
export type SearchResults = Schemas["SearchResponse"];
export type SearchGroup = Schemas["SearchGroupResponse"];
export type SearchHit = Schemas["SearchHitResponse"];
export type SearchModule = SearchGroup["module"];
export type SearchQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/search"]["get"]["parameters"]["query"]
>;
export type UniversalSearchResults = Schemas["UniversalSearchResponse"];
export type UniversalSearchHit = Schemas["UniversalSearchHitResponse"];
export type UniversalSearchFacet = Schemas["SearchFacetResponse"];
export type UniversalSearchDetail = Schemas["SearchDetailResponse"];
export type UniversalSearchModule = UniversalSearchHit["module"];
export type SearchEntityType = UniversalSearchHit["entity_type"];
export type SearchMatchKind = UniversalSearchHit["match"];
export type UniversalSearchQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/search/results"]["get"]["parameters"]["query"]
>;
export type SearchFilters = Schemas["SavedSearchFilters"];
export type SearchSort = SearchFilters["sort"];
export type RecentSearch = Schemas["RecentSearchResponse"];
export type RecentSearchList = Schemas["RecentSearchListResponse"];
export type SavedSearch = Schemas["SavedSearchResponse"];
export type SavedSearchList = Schemas["SavedSearchListResponse"];
export type SavedSearchCreate = Schemas["SavedSearchCreateRequest"];
export type SavedSearchUpdate = Schemas["SavedSearchUpdateRequest"];
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
export type MarketData = Schemas["MarketDataResponse"];
export type MarketDataUpdateRequest = Schemas["MarketDataUpdateRequest"];
export type Instrument = Schemas["InstrumentResponse"];
export type InstrumentList = Schemas["InstrumentListResponse"];
export type PriceRefresh = Schemas["PriceRefreshResponse"];
export type OpeningPositionRequest = Schemas["OpeningPositionRequest"];
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
export type HabitCategory = Schemas["HabitCategoryResponse"];
export type HabitCategoryList = Schemas["HabitCategoryListResponse"];
export type CreateHabitCategoryRequest = Schemas["CreateHabitCategoryRequest"];
export type UpdateHabitCategoryRequest = Schemas["UpdateHabitCategoryRequest"];
export type Habit = Schemas["HabitResponse"];
export type HabitKind = Habit["kind"];
export type HabitStatus = Habit["status"];
export type HabitColor = Habit["color"];
export type HabitIcon = Habit["icon"];
export type HabitSchedule = Schemas["HabitScheduleModel"];
export type HabitScheduleType = HabitSchedule["type"];
export type HabitLog = Schemas["HabitLogResponse"];
export type HabitPeriod = Schemas["HabitPeriodResponse"];
export type HabitProgress = Schemas["HabitProgressResponse"];
export type HabitDayState = HabitProgress["state"];
export type HabitDetail = Schemas["HabitDetailResponse"];
export type HabitList = Schemas["HabitListResponse"];
export type HabitReminderTime = Schemas["HabitReminderTimeModel"];
export type HabitToday = Schemas["HabitTodayResponse"];
export type HabitHeatmapDay = Schemas["HabitHeatmapDayResponse"];
export type HabitHistory = Schemas["HabitHistoryResponse"];
export type HabitAnalytics = Schemas["HabitAnalyticsResponse"];
export type HabitPerformance = Schemas["HabitPerformanceResponse"];
export type HabitTrendPoint = Schemas["HabitTrendPointResponse"];
export type HabitCalendarEntry = Schemas["HabitCalendarEntryResponse"];
export type HabitCalendar = Schemas["HabitCalendarResponse"];
export type CreateHabitRequest = Schemas["CreateHabitRequest"];
export type UpdateHabitRequest = Schemas["UpdateHabitRequest"];
export type LogHabitRequest = Schemas["LogHabitRequest"];
export type CreateHabitNoteRequest = Schemas["CreateHabitNoteRequest"];
export type Routine = Schemas["RoutineDetailResponse"];
export type RoutineList = Schemas["RoutineListResponse"];
export type RoutineStep = Schemas["RoutineStepResponse"];
export type RoutineStepRequest = Schemas["RoutineStepRequest"];
export type RoutineSession = Schemas["RoutineSessionResponse"];
export type RoutineSessionList = Schemas["RoutineSessionListResponse"];
export type RoutineSessionStep = Schemas["RoutineSessionStepResponse"];
export type RoutineStepStatus = RoutineSessionStep["status"];
export type CreateRoutineRequest = Schemas["CreateRoutineRequest"];
export type UpdateRoutineRequest = Schemas["UpdateRoutineRequest"];
export type UpdateRoutineSessionRequest = Schemas["UpdateRoutineSessionRequest"];
export type HabitListQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/habits"]["get"]["parameters"]["query"]
>;
export type HabitTodayQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/habits/today"]["get"]["parameters"]["query"]
>;
export type HabitAnalyticsQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/habits/analytics"]["get"]["parameters"]["query"]
>;
export type HabitCalendarQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/habits/calendar"]["get"]["parameters"]["query"]
>;
export type HabitHistoryQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/habits/{habit_id}/history"]["get"]["parameters"]["query"]
>;
export type RoutineSessionListQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/routines/{routine_id}/sessions"]["get"]["parameters"]["query"]
>;

// Documents and the personal vault
export type DocumentSummary = Schemas["DocumentSummaryResponse"];
export type DocumentRecord = Schemas["DocumentResponse"];
export type DocumentDetail = Schemas["DocumentDetailResponse"];
export type DocumentList = Schemas["DocumentListResponse"];
export type DocumentFile = Schemas["DocumentFileResponse"];
export type DocumentVersion = Schemas["DocumentVersionResponse"];
export type DocumentRenewal = Schemas["DocumentRenewalResponse"];
export type DocumentLink = Schemas["DocumentLinkResponse"];
export type DocumentLinkKind = DocumentLink["kind"];
export type DocumentLinkCandidates = Schemas["DocumentLinkCandidatesResponse"];
export type DocumentCustomField = Schemas["DocumentCustomField"];
export type DocumentCounts = Schemas["DocumentCountsResponse"];
export type DocumentOverview = Schemas["DocumentOverviewResponse"];
export type DocumentSettings = Schemas["DocumentSettingsResponse"];
export type DocumentState = DocumentSummary["state"];
export type ExpiryStatus = DocumentSummary["expiry_status"];
export type DocumentFolder = Schemas["DocumentFolderResponse"];
export type DocumentFolderList = Schemas["DocumentFolderListResponse"];
export type CreateDocumentFolderRequest = Schemas["CreateDocumentFolderRequest"];
export type UpdateDocumentFolderRequest = Schemas["UpdateDocumentFolderRequest"];
export type DocumentFolderDeleteMode = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/document-folders/{folder_id}"]["delete"]["parameters"]["query"]
>["documents"];
export type DocumentCategory = Schemas["DocumentCategoryResponse"];
export type DocumentCategoryList = Schemas["DocumentCategoryListResponse"];
export type DocumentCategoryIcon = DocumentCategory["icon"];
export type CreateDocumentCategoryRequest = Schemas["CreateDocumentCategoryRequest"];
export type UpdateDocumentCategoryRequest = Schemas["UpdateDocumentCategoryRequest"];
export type DocumentTag = Schemas["DocumentTagResponse"];
export type DocumentTagList = Schemas["DocumentTagListResponse"];
export type CreateDocumentRequest = Schemas["CreateDocumentRequest"];
export type UpdateDocumentRequest = Schemas["UpdateDocumentRequest"];
export type RenewDocumentRequest = Schemas["RenewDocumentRequest"];
export type ExportDocumentsRequest = Schemas["ExportDocumentsRequest"];
/** Filters, search, sorting, and paging accepted when listing documents. */
export type DocumentListQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/documents"]["get"]["parameters"]["query"]
>;
export type DocumentSort = NonNullable<DocumentListQuery["sort"]>;
export type DocumentFileKind = NonNullable<DocumentListQuery["file_kind"]>;

// Health and fitness. Values are canonical integer units named by their suffix (`_g`, `_mm`,
// `_m`, `_s`, `_ml`, `_mg`, `_cal`, `_milli`); the web app converts to the person's units.
type FitnessPath = "/api/v1/workspaces/{workspace_id}/fitness";
export type FitnessProfile = Schemas["ProfileResponse"];
export type FitnessProfileRequest = Schemas["ProfileRequest"];
export type FitnessTargets = Schemas["TargetsModel"];
export type FitnessNutrients = Schemas["NutrientsModel"];
export type WeightUnit = FitnessProfile["weight_unit"];
export type LengthUnit = FitnessProfile["length_unit"];
export type DistanceUnit = FitnessProfile["distance_unit"];
export type EnergyUnit = FitnessProfile["energy_unit"];
export type WaterUnit = FitnessProfile["water_unit"];
export type UnitSystem = FitnessProfile["unit_system"];
export type FitnessSection = FitnessProfile["hidden_sections"][number];
export type Exercise = Schemas["ExerciseResponse"];
export type ExerciseList = Schemas["ExerciseListResponse"];
export type ExerciseRequest = Schemas["ExerciseRequest"];
export type ExerciseCategory = Exercise["category"];
export type ExerciseType = Exercise["exercise_type"];
export type Equipment = Exercise["equipment"];
export type Muscle = Exercise["primary_muscles"][number];
export type ExerciseHistory = Schemas["ExerciseHistoryResponse"];
export type ExercisePoint = Schemas["ExercisePointResponse"];
export type WorkoutTemplate = Schemas["TemplateResponse"];
export type WorkoutTemplateList = Schemas["TemplateListResponse"];
export type WorkoutTemplateRequest = Schemas["TemplateRequest"];
export type WorkoutTemplateExercise = Schemas["TemplateExerciseResponse"];
export type WorkoutTemplateExerciseRequest = Schemas["TemplateExerciseRequest"];
export type WorkoutTemplateCategory = WorkoutTemplate["category"];
export type Workout = Schemas["SessionResponse"];
export type WorkoutStatus = Workout["status"];
export type WorkoutExercise = Schemas["SessionExerciseResponse"];
export type WorkoutSet = Schemas["SetResponse"];
export type WorkoutSetRequest = Schemas["SetRequest"];
export type WorkoutSetType = WorkoutSet["set_type"];
export type WorkoutSummary = Schemas["SessionSummaryResponse"];
export type WorkoutList = Schemas["SessionListResponse"];
export type ActiveWorkout = Schemas["ActiveSessionResponse"];
export type StartWorkoutRequest = Schemas["StartSessionRequest"];
export type LogWorkoutRequest = Schemas["LogSessionRequest"];
export type UpdateWorkoutRequest = Schemas["UpdateSessionRequest"];
export type WorkoutListQuery = NonNullable<
  paths[`${FitnessPath}/sessions`]["get"]["parameters"]["query"]
>;
export type PersonalRecord = Schemas["PersonalRecordResponse"];
export type PersonalRecordKind = PersonalRecord["kind"];
export type PersonalRecordList = Schemas["RecordListResponse"];
export type WorkoutAnalytics = Schemas["WorkoutAnalyticsResponse"];
export type WorkoutAnalyticsQuery = paths[`${FitnessPath}/analytics`]["get"]["parameters"]["query"];
export type Measurement = Schemas["MeasurementResponse"];
export type MeasurementRequest = Schemas["MeasurementRequest"];
export type MeasurementList = Schemas["MeasurementListResponse"];
export type Bmi = Schemas["BmiResponse"];
export type ProgressPhoto = Schemas["PhotoResponse"];
export type ProgressPhotoList = Schemas["PhotoListResponse"];
export type Food = Schemas["FoodResponse"];
export type FoodList = Schemas["FoodListResponse"];
export type FoodRequest = Schemas["FoodRequest"];
export type Portion = Schemas["PortionResponse"];
export type PortionRequest = Schemas["PortionRequest"];
export type SavedMeal = Schemas["MealResponse"];
export type SavedMealList = Schemas["MealListResponse"];
export type SavedMealRequest = Schemas["MealRequest"];
export type FoodEntry = Schemas["FoodEntryResponse"];
export type FoodEntryRequest = Schemas["FoodEntryRequest"];
export type MealType = FoodEntry["meal"];
export type NutritionDay = Schemas["NutritionDayResponse"];
export type NutritionHistory = Schemas["NutritionHistoryResponse"];
export type WaterDay = Schemas["WaterDayResponse"];
export type WaterHistory = Schemas["WaterHistoryResponse"];
export type Activity = Schemas["ActivityResponse"];
export type ActivityList = Schemas["ActivityListResponse"];
export type ActivityRequest = Schemas["ActivityRequest"];
export type ActivityKind = Activity["kind"];
export type FitnessGoal = Schemas["FitnessGoalResponse"];
export type FitnessGoalList = Schemas["FitnessGoalListResponse"];
export type FitnessGoalRequest = Schemas["GoalRequest"];
export type FitnessGoalCategory = FitnessGoal["category"];
export type FitnessGoalStatus = FitnessGoal["status"];
export type FitnessGoalPace = FitnessGoal["pace"];
export type FitnessCheckIn = Schemas["CheckInResponse"];
export type FitnessHabitLink = Schemas["HabitLinkResponse"];
export type FitnessHabitLinkList = Schemas["HabitLinkListResponse"];
export type FitnessHabitLinkRequest = Schemas["HabitLinkRequest"];
export type ScheduledWorkout = Schemas["ScheduledWorkoutResponse"];
export type ScheduledWorkoutList = Schemas["ScheduledWorkoutListResponse"];
export type ScheduleWorkoutRequest = Schemas["ScheduleWorkoutRequest"];
export type FitnessLinkedRecord = Schemas["LinkedRecordResponse"];
export type FitnessLinkList = Schemas["LinkListResponse"];
export type FitnessOverview = Schemas["FitnessOverviewResponse"];

// AI
export type AiSettings = Schemas["AiSettingsResponse"];
export type UpdateAiSettingsRequest = Schemas["UpdateAiSettingsRequest"];
export type AiModule = AiSettings["modules"][number];
export type AiResponseStyle = AiSettings["response_style"];
export type AiProvider = Schemas["AiProviderResponse"];
export type AiProviderList = Schemas["AiProviderListResponse"];
export type AiProviderKind = AiProvider["kind"];
export type AiProcessing = AiProvider["processing"];
export type CreateAiProviderRequest = Schemas["CreateAiProviderRequest"];
export type UpdateAiProviderRequest = Schemas["UpdateAiProviderRequest"];
export type TestAiProviderRequest = Schemas["TestAiProviderRequest"];
export type AiConnectionTest = Schemas["AiConnectionTestResponse"];
export type AiModel = Schemas["AiModelResponse"];
export type AiModelList = Schemas["AiModelListResponse"];
export type AiUsage = Schemas["AiUsageResponse"];
export type AiUsageLine = Schemas["AiUsageLineResponse"];
export type AiRecordRef = Schemas["AiRecordRef"];
export type AiCitation = Schemas["AiCitationResponse"];
export type AiProposal = Schemas["AiProposalResponse"];
export type AiMessage = Schemas["AiMessageResponse"];
export type AiConversation = Schemas["AiConversationResponse"];
export type AiConversationList = Schemas["AiConversationListResponse"];
export type AiConversationDetail = Schemas["AiConversationDetailResponse"];
export type SendAiMessageRequest = Schemas["SendAiMessageRequest"];
/** The first event of a streamed answer (`AiTurnStarted` in the API; not in OpenAPI, which
 * can't describe event streams). */
export type AiTurnStarted = {
  conversation: AiConversation;
  provider_name: string;
  model: string;
  processing: AiProcessing;
};
/** The last event of a streamed answer (`AiStreamDone` in the API). */
export type AiStreamDone = { message: AiMessage; proposals: AiProposal[] };
export type AiAssistRequest = Schemas["AiAssistRequest"];
export type AiAssistKind = AiAssistRequest["kind"];
export type AiAssistResult = Schemas["AiAssistResponse"];
export type AiSearchQuery = NonNullable<
  paths["/api/v1/workspaces/{workspace_id}/ai/search"]["get"]["parameters"]["query"]
>;
export type AiSearchResults = Schemas["AiSearchResponse"];
export type AiSearchMatch = Schemas["AiSearchMatchResponse"];
export type AiInsight = Schemas["AiInsightResponse"];
export type AiInsightList = Schemas["AiInsightListResponse"];
export type AiIndexStatus = Schemas["AiIndexResponse"];

// External integrations
export type IntegrationProvider = Schemas["IntegrationProviderResponse"];
export type IntegrationProviderId = IntegrationProvider["provider"];
export type IntegrationCapability = Schemas["IntegrationCapabilityResponse"]["capability"];
export type IntegrationCapabilityInfo = Schemas["IntegrationCapabilityResponse"];
export type IntegrationProviderList = Schemas["IntegrationProviderListResponse"];
export type AuthorizeIntegrationRequest = Schemas["AuthorizeIntegrationRequest"];
export type AuthorizeIntegrationResult = Schemas["AuthorizeIntegrationResponse"];
export type CompleteAuthorizationRequest = Schemas["CompleteAuthorizationRequest"];
export type IntegrationConnection = Schemas["IntegrationConnectionResponse"];
export type IntegrationConnectionStatus = IntegrationConnection["status"];
export type IntegrationConnectionList = Schemas["IntegrationConnectionListResponse"];
export type IntegrationConnectionDetail = Schemas["IntegrationConnectionDetailResponse"];
export type UpdateIntegrationConnectionRequest = Schemas["UpdateIntegrationConnectionRequest"];
export type IntegrationCalendar = Schemas["IntegrationCalendarResponse"];
export type IntegrationCalendarList = Schemas["IntegrationCalendarListResponse"];
export type UpdateIntegrationCalendarRequest = Schemas["UpdateIntegrationCalendarRequest"];
export type IntegrationSyncDirection = IntegrationCalendar["direction"];
export type IntegrationSyncRun = Schemas["IntegrationSyncRunResponse"];
export type IntegrationSyncRunList = Schemas["IntegrationSyncRunListResponse"];
export type IntegrationSyncRequest = Schemas["IntegrationSyncRequest"];
export type DisconnectIntegrationResult = Schemas["DisconnectIntegrationResponse"];
export type IntegrationLink = Schemas["IntegrationLinkResponse"];
export type IntegrationConflict = Schemas["IntegrationConflictResponse"];
export type IntegrationConflictList = Schemas["IntegrationConflictListResponse"];
export type IntegrationConflictResolution =
  Schemas["ResolveIntegrationConflictRequest"]["resolution"];
export type ResolveIntegrationConflictResult = Schemas["ResolveIntegrationConflictResponse"];
export type IntegrationOrigin = Schemas["IntegrationOriginResponse"];
export type IntegrationOriginList = Schemas["IntegrationOriginListResponse"];
export type IntegrationEntityType = IntegrationLink["entity_type"];
export type IntegrationRecord = Schemas["IntegrationRecordResponse"];
export type MailLabel = Schemas["MailLabelResponse"];
export type MailLabelList = Schemas["MailLabelListResponse"];
export type MailMessage = Schemas["MessageSummaryResponse"];
export type MailMessageList = Schemas["MessageListResponse"];
export type MailMessageDetail = Schemas["MessageDetailResponse"];
export type RemoteFile = Schemas["RemoteFileResponse"];
export type RemoteFileList = Schemas["RemoteFileListResponse"];
export type ImportFileRequest = Schemas["ImportFileRequest"];
export type ImportedFile = Schemas["ImportedFileResponse"];

// Backups, restores, imports, and exports
export type BackupOverview = Schemas["BackupOverviewResponse"];
export type Backup = Schemas["BackupResponse"];
export type BackupKind = Backup["kind"];
export type BackupStatus = Backup["status"];
export type BackupSettings = Schemas["BackupSettingsResponse"];
export type BackupFrequency = BackupSettings["frequency"];
export type BackupUpload = Schemas["BackupUploadResponse"];
export type BackupUploadStatus = BackupUpload["status"];
export type CreateBackupRequest = Schemas["CreateBackupRequest"];
export type BackupEncryption = NonNullable<CreateBackupRequest["encryption"]>;
export type UpdateBackupSettingsRequest = Schemas["UpdateBackupSettingsRequest"];
export type ExportArchiveRequest = Schemas["ExportArchiveRequest"];
export type ExportModuleRequest = Schemas["ExportModuleRequest"];
export type ExportModuleInfo = Schemas["ExportModuleInfo"];
export type BackupModule = ExportModuleInfo["module"];
export type ExportFormat = ExportModuleInfo["formats"][number];
export type ArchivePasswordRequest = Schemas["ArchivePasswordRequest"];
export type RestoreUploadRequest = Schemas["RestoreUploadRequest"];
export type RestoreStrategy = NonNullable<RestoreUploadRequest["strategy"]>;
export type RestoreReport = Schemas["RestoreReportResponse"];
export type BackupInspection = Schemas["InspectionResponse"];
export type BackupVerification = Schemas["VerificationResponse"];

// Personal agent and automation
export type Agent = Schemas["AgentResponse"];
export type AgentAutonomy = Agent["autonomy"];
export type AgentModule = Agent["modules"][number];
export type AgentToolMode = Agent["tool_modes"][string];
export type AgentToolAccess = Agent["action_types"][number];
export type AgentTriggerKind = Agent["autonomous_triggers"][number];
export type AgentLimits = Schemas["AgentLimitsSchema"];
export type AgentMemorySettings = Schemas["AgentMemorySettingsSchema"];
export type AgentNotificationSettings = Schemas["AgentNotificationSettingsSchema"];
export type AgentMonitorSettings = Schemas["AgentMonitorSettingsSchema"];
export type AgentMonitorCategory = NonNullable<AgentMonitorSettings["categories"]>[number];
export type AgentMonitorFrequency = AgentMonitorSettings["frequency"];
export type AgentRuntime = Schemas["AgentRuntimeResponse"];
export type AgentOverview = Schemas["AgentOverviewResponse"];
export type UpdateAgentRequest = Schemas["UpdateAgentRequest"];
export type AgentTool = Schemas["AgentToolResponse"];
export type AgentToolList = Schemas["AgentToolListResponse"];
export type AgentToolOutcome = AgentTool["outcome"];
export type AgentRisk = AgentTool["risk"];
export type AgentSchedule = Schemas["AgentScheduleSchema"];
export type AgentScheduleFrequency = AgentSchedule["frequency"];
export type AgentEventTrigger = Schemas["AgentEventTriggerSchema"];
export type AgentEventKind = AgentEventTrigger["event"];
export type AgentConditionTrigger = Schemas["AgentConditionTriggerSchema"];
export type AgentConditionMetric = AgentConditionTrigger["metric"];
export type AgentTrigger = Schemas["AgentTriggerSchema"];
export type AgentCondition = Schemas["AgentConditionSchema"];
export type AgentCompareOp = AgentCondition["op"];
export type AgentWorkflowStep = Schemas["AgentWorkflowStepSchema"];
export type AgentStepKind = AgentWorkflowStep["kind"];
export type AgentWorkflowRequest = Schemas["AgentWorkflowRequest"];
export type AgentWorkflow = Schemas["AgentWorkflowResponse"];
export type AgentWorkflowList = Schemas["AgentWorkflowListResponse"];
export type StartAgentRunRequest = Schemas["StartAgentRunRequest"];
export type RunAgentWorkflowRequest = Schemas["RunAgentWorkflowRequest"];
export type AgentExecution = Schemas["AgentExecutionResponse"];
export type AgentExecutionStatus = AgentExecution["status"];
export type AgentExecutionList = Schemas["AgentExecutionListResponse"];
export type AgentExecutionStep = Schemas["AgentExecutionStepResponse"];
export type AgentStepStatus = AgentExecutionStep["status"];
export type AgentExecutionDetail = Schemas["AgentExecutionDetailResponse"];
export type AgentApproval = Schemas["AgentApprovalResponse"];
export type AgentApprovalStatus = AgentApproval["status"];
export type AgentApprovalList = Schemas["AgentApprovalListResponse"];
export type AgentMemory = Schemas["AgentMemoryResponse"];
export type AgentMemoryList = Schemas["AgentMemoryListResponse"];
export type AgentMemoryCategory = AgentMemory["category"];
