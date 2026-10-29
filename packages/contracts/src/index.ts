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
