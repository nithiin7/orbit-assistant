import type {
  ActiveWorkout,
  Activity,
  ActivityKind,
  ActivityList,
  ActivityRequest,
  Exercise,
  ExerciseHistory,
  ExerciseList,
  ExerciseRequest,
  FitnessGoal,
  FitnessGoalList,
  FitnessGoalRequest,
  FitnessGoalStatus,
  FitnessHabitLink,
  FitnessHabitLinkList,
  FitnessHabitLinkRequest,
  FitnessLinkList,
  FitnessOverview,
  FitnessProfile,
  FitnessProfileRequest,
  Food,
  FoodEntry,
  FoodEntryRequest,
  FoodList,
  FoodRequest,
  LogWorkoutRequest,
  MealType,
  Measurement,
  MeasurementList,
  MeasurementRequest,
  NutritionDay,
  NutritionHistory,
  PersonalRecordList,
  ProgressPhoto,
  ProgressPhotoList,
  SavedMeal,
  SavedMealList,
  SavedMealRequest,
  ScheduledWorkout,
  ScheduledWorkoutList,
  ScheduleWorkoutRequest,
  StartWorkoutRequest,
  UpdateWorkoutRequest,
  WaterDay,
  WaterHistory,
  Workout,
  WorkoutAnalytics,
  WorkoutAnalyticsQuery,
  WorkoutList,
  WorkoutListQuery,
  WorkoutSetRequest,
  WorkoutTemplate,
  WorkoutTemplateList,
  WorkoutTemplateRequest,
} from "@orbit/contracts";

import { ApiError, request, send, type Signal, toQueryString, workspacePath } from "../client";

function fitnessPath(workspaceId: string, suffix = ""): string {
  return workspacePath(workspaceId, `/fitness${suffix}`);
}

function id(value: string): string {
  return `/${encodeURIComponent(value)}`;
}

function sessionPath(workspaceId: string, sessionId: string, suffix = ""): string {
  return fitnessPath(workspaceId, `/sessions${id(sessionId)}${suffix}`);
}

type Day = { date: string };
type Range = { start: string; end: string };

// Overview and profile

export function getFitnessOverview(
  token: string,
  workspaceId: string,
  query: Day & { timezone?: string | null },
  { signal }: Signal = {},
): Promise<FitnessOverview> {
  return request(fitnessPath(workspaceId, `/overview${toQueryString(query)}`), { token, signal });
}

export function getFitnessProfile(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<FitnessProfile> {
  return request(fitnessPath(workspaceId, "/profile"), { token, signal });
}

export function saveFitnessProfile(
  token: string,
  workspaceId: string,
  body: FitnessProfileRequest,
): Promise<FitnessProfile> {
  return request(fitnessPath(workspaceId, "/profile"), { method: "PUT", body, token });
}

// Exercises

export function listExercises(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<ExerciseList> {
  return request(fitnessPath(workspaceId, "/exercises"), { token, signal });
}

export function createExercise(
  token: string,
  workspaceId: string,
  body: ExerciseRequest,
): Promise<Exercise> {
  return request(fitnessPath(workspaceId, "/exercises"), { method: "POST", body, token });
}

export function updateExercise(
  token: string,
  workspaceId: string,
  exerciseId: string,
  body: ExerciseRequest,
): Promise<Exercise> {
  return request(fitnessPath(workspaceId, `/exercises${id(exerciseId)}`), {
    method: "PUT",
    body,
    token,
  });
}

export function archiveExercise(
  token: string,
  workspaceId: string,
  exerciseId: string,
  archived: boolean,
): Promise<Exercise> {
  return request(fitnessPath(workspaceId, `/exercises${id(exerciseId)}/archive`), {
    method: "POST",
    body: { archived },
    token,
  });
}

export function deleteExercise(token: string, workspaceId: string, exerciseId: string) {
  return request<void>(fitnessPath(workspaceId, `/exercises${id(exerciseId)}`), {
    method: "DELETE",
    token,
  });
}

export function getExerciseHistory(
  token: string,
  workspaceId: string,
  exerciseId: string,
  { signal }: Signal = {},
): Promise<ExerciseHistory> {
  return request(fitnessPath(workspaceId, `/exercises${id(exerciseId)}/history`), {
    token,
    signal,
  });
}

// Templates

export function listTemplates(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<WorkoutTemplateList> {
  return request(fitnessPath(workspaceId, "/templates"), { token, signal });
}

export function saveTemplate(
  token: string,
  workspaceId: string,
  templateId: string | null,
  body: WorkoutTemplateRequest,
): Promise<WorkoutTemplate> {
  return templateId === null
    ? request(fitnessPath(workspaceId, "/templates"), { method: "POST", body, token })
    : request(fitnessPath(workspaceId, `/templates${id(templateId)}`), {
        method: "PUT",
        body,
        token,
      });
}

export function duplicateTemplate(
  token: string,
  workspaceId: string,
  templateId: string,
): Promise<WorkoutTemplate> {
  return request(fitnessPath(workspaceId, `/templates${id(templateId)}/duplicate`), {
    method: "POST",
    token,
  });
}

export function archiveTemplate(
  token: string,
  workspaceId: string,
  templateId: string,
  archived: boolean,
): Promise<WorkoutTemplate> {
  return request(fitnessPath(workspaceId, `/templates${id(templateId)}/archive`), {
    method: "POST",
    body: { archived },
    token,
  });
}

export function deleteTemplate(token: string, workspaceId: string, templateId: string) {
  return request<void>(fitnessPath(workspaceId, `/templates${id(templateId)}`), {
    method: "DELETE",
    token,
  });
}

// Workouts

export function listWorkouts(
  token: string,
  workspaceId: string,
  query: WorkoutListQuery,
  { signal }: Signal = {},
): Promise<WorkoutList> {
  return request(fitnessPath(workspaceId, `/sessions${toQueryString(query)}`), { token, signal });
}

export function getActiveWorkout(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<ActiveWorkout> {
  return request(fitnessPath(workspaceId, "/sessions/active"), { token, signal });
}

export function getWorkout(
  token: string,
  workspaceId: string,
  sessionId: string,
  { signal }: Signal = {},
): Promise<Workout> {
  return request(sessionPath(workspaceId, sessionId), { token, signal });
}

export function startWorkout(
  token: string,
  workspaceId: string,
  body: StartWorkoutRequest,
): Promise<Workout> {
  return request(fitnessPath(workspaceId, "/sessions"), { method: "POST", body, token });
}

export function updateWorkout(
  token: string,
  workspaceId: string,
  sessionId: string,
  body: UpdateWorkoutRequest,
): Promise<Workout> {
  return request(sessionPath(workspaceId, sessionId), { method: "PATCH", body, token });
}

export type WorkoutAction = "pause" | "resume" | "complete" | "abandon";

export function workoutAction(
  token: string,
  workspaceId: string,
  sessionId: string,
  action: WorkoutAction,
): Promise<Workout> {
  return request(sessionPath(workspaceId, sessionId, `/${action}`), { method: "POST", token });
}

export function deleteWorkout(token: string, workspaceId: string, sessionId: string) {
  return request<void>(sessionPath(workspaceId, sessionId), { method: "DELETE", token });
}

export function addWorkoutExercise(
  token: string,
  workspaceId: string,
  sessionId: string,
  exerciseId: string,
): Promise<Workout> {
  return request(sessionPath(workspaceId, sessionId, "/exercises"), {
    method: "POST",
    body: { exercise_id: exerciseId },
    token,
  });
}

export function updateWorkoutExercise(
  token: string,
  workspaceId: string,
  sessionId: string,
  itemId: string,
  body: { rest_seconds: number | null; notes: string },
): Promise<Workout> {
  return request(sessionPath(workspaceId, sessionId, `/exercises${id(itemId)}`), {
    method: "PATCH",
    body,
    token,
  });
}

export function removeWorkoutExercise(
  token: string,
  workspaceId: string,
  sessionId: string,
  itemId: string,
): Promise<Workout> {
  return request(sessionPath(workspaceId, sessionId, `/exercises${id(itemId)}`), {
    method: "DELETE",
    token,
  });
}

export function reorderWorkout(
  token: string,
  workspaceId: string,
  sessionId: string,
  exerciseIds: readonly string[],
): Promise<Workout> {
  return request(sessionPath(workspaceId, sessionId, "/order"), {
    method: "PUT",
    body: { exercise_ids: exerciseIds },
    token,
  });
}

/** Without `values`, the API copies the exercise's last set. */
export function addWorkoutSet(
  token: string,
  workspaceId: string,
  sessionId: string,
  itemId: string,
  values: WorkoutSetRequest | null,
): Promise<Workout> {
  return request(sessionPath(workspaceId, sessionId, `/exercises${id(itemId)}/sets`), {
    method: "POST",
    body: { values },
    token,
  });
}

export function updateWorkoutSet(
  token: string,
  workspaceId: string,
  sessionId: string,
  itemId: string,
  setId: string,
  values: WorkoutSetRequest,
): Promise<Workout> {
  return request(sessionPath(workspaceId, sessionId, `/exercises${id(itemId)}/sets${id(setId)}`), {
    method: "PUT",
    body: values,
    token,
  });
}

export function deleteWorkoutSet(
  token: string,
  workspaceId: string,
  sessionId: string,
  itemId: string,
  setId: string,
): Promise<Workout> {
  return request(sessionPath(workspaceId, sessionId, `/exercises${id(itemId)}/sets${id(setId)}`), {
    method: "DELETE",
    token,
  });
}

export function createWorkoutNote(
  token: string,
  workspaceId: string,
  sessionId: string,
): Promise<FitnessLinkList> {
  return request(sessionPath(workspaceId, sessionId, "/note"), {
    method: "POST",
    body: {},
    token,
  });
}

export type LinkOwner = "sessions" | "goals";
export type LinkTarget = "note" | "document";

export function setFitnessLink(
  token: string,
  workspaceId: string,
  owner: LinkOwner,
  ownerId: string,
  target: LinkTarget,
  targetId: string,
  linked: boolean,
): Promise<FitnessLinkList | undefined> {
  const path = fitnessPath(workspaceId, `/${owner}${id(ownerId)}/links/${target}${id(targetId)}`);
  return linked
    ? request<FitnessLinkList>(path, { method: "PUT", token })
    : request<undefined>(path, { method: "DELETE", token });
}

export function listRecords(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<PersonalRecordList> {
  return request(fitnessPath(workspaceId, "/records"), { token, signal });
}

export function getWorkoutAnalytics(
  token: string,
  workspaceId: string,
  query: WorkoutAnalyticsQuery,
  { signal }: Signal = {},
): Promise<WorkoutAnalytics> {
  return request(fitnessPath(workspaceId, `/analytics${toQueryString(query)}`), { token, signal });
}

// Body

export function listMeasurements(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<MeasurementList> {
  return request(fitnessPath(workspaceId, "/measurements"), { token, signal });
}

export function saveMeasurement(
  token: string,
  workspaceId: string,
  measurementId: string | null,
  body: MeasurementRequest,
): Promise<Measurement> {
  return measurementId === null
    ? request(fitnessPath(workspaceId, "/measurements"), { method: "POST", body, token })
    : request(fitnessPath(workspaceId, `/measurements${id(measurementId)}`), {
        method: "PUT",
        body,
        token,
      });
}

export function deleteMeasurement(token: string, workspaceId: string, measurementId: string) {
  return request<void>(fitnessPath(workspaceId, `/measurements${id(measurementId)}`), {
    method: "DELETE",
    token,
  });
}

export function listPhotos(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<ProgressPhotoList> {
  return request(fitnessPath(workspaceId, "/photos"), { token, signal });
}

export function uploadPhoto(
  token: string,
  workspaceId: string,
  file: File,
  day: string,
  note: string,
): Promise<ProgressPhoto> {
  const query = toQueryString({ filename: file.name, day, note });
  return request(fitnessPath(workspaceId, `/photos${query}`), {
    method: "POST",
    body: file,
    token,
  });
}

/** The image itself; there's no URL that works without the token. */
export async function downloadPhoto(
  token: string,
  workspaceId: string,
  photoId: string,
  { signal }: Signal = {},
): Promise<Blob> {
  const response = await send(fitnessPath(workspaceId, `/photos${id(photoId)}/file`), {
    token,
    signal,
  });
  return response.blob();
}

export function deletePhoto(token: string, workspaceId: string, photoId: string) {
  return request<void>(fitnessPath(workspaceId, `/photos${id(photoId)}`), {
    method: "DELETE",
    token,
  });
}

// Nutrition

export function listFoods(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<FoodList> {
  return request(fitnessPath(workspaceId, "/foods"), { token, signal });
}

export function saveFood(
  token: string,
  workspaceId: string,
  foodId: string | null,
  body: FoodRequest,
): Promise<Food> {
  return foodId === null
    ? request(fitnessPath(workspaceId, "/foods"), { method: "POST", body, token })
    : request(fitnessPath(workspaceId, `/foods${id(foodId)}`), { method: "PUT", body, token });
}

export function deleteFood(token: string, workspaceId: string, foodId: string) {
  return request<void>(fitnessPath(workspaceId, `/foods${id(foodId)}`), {
    method: "DELETE",
    token,
  });
}

export function listMeals(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<SavedMealList> {
  return request(fitnessPath(workspaceId, "/meals"), { token, signal });
}

export function saveMeal(
  token: string,
  workspaceId: string,
  mealId: string | null,
  body: SavedMealRequest,
): Promise<SavedMeal> {
  return mealId === null
    ? request(fitnessPath(workspaceId, "/meals"), { method: "POST", body, token })
    : request(fitnessPath(workspaceId, `/meals${id(mealId)}`), { method: "PUT", body, token });
}

export function deleteMeal(token: string, workspaceId: string, mealId: string) {
  return request<void>(fitnessPath(workspaceId, `/meals${id(mealId)}`), {
    method: "DELETE",
    token,
  });
}

export function logMeal(
  token: string,
  workspaceId: string,
  mealId: string,
  day: string,
  meal: MealType,
): Promise<{ entries: FoodEntry[] }> {
  return request(fitnessPath(workspaceId, `/meals${id(mealId)}/log`), {
    method: "POST",
    body: { day, meal },
    token,
  });
}

export function getNutritionDay(
  token: string,
  workspaceId: string,
  query: Day,
  { signal }: Signal = {},
): Promise<NutritionDay> {
  return request(fitnessPath(workspaceId, `/nutrition${toQueryString(query)}`), { token, signal });
}

export function getNutritionHistory(
  token: string,
  workspaceId: string,
  query: Range,
  { signal }: Signal = {},
): Promise<NutritionHistory> {
  return request(fitnessPath(workspaceId, `/nutrition/history${toQueryString(query)}`), {
    token,
    signal,
  });
}

export function saveFoodEntry(
  token: string,
  workspaceId: string,
  entryId: string | null,
  body: FoodEntryRequest,
): Promise<FoodEntry> {
  return entryId === null
    ? request(fitnessPath(workspaceId, "/food-entries"), { method: "POST", body, token })
    : request(fitnessPath(workspaceId, `/food-entries${id(entryId)}`), {
        method: "PUT",
        body,
        token,
      });
}

export function deleteFoodEntry(token: string, workspaceId: string, entryId: string) {
  return request<void>(fitnessPath(workspaceId, `/food-entries${id(entryId)}`), {
    method: "DELETE",
    token,
  });
}

export function getWaterDay(
  token: string,
  workspaceId: string,
  query: Day,
  { signal }: Signal = {},
): Promise<WaterDay> {
  return request(fitnessPath(workspaceId, `/water${toQueryString(query)}`), { token, signal });
}

export function getWaterHistory(
  token: string,
  workspaceId: string,
  query: Range,
  { signal }: Signal = {},
): Promise<WaterHistory> {
  return request(fitnessPath(workspaceId, `/water/history${toQueryString(query)}`), {
    token,
    signal,
  });
}

export function addWater(
  token: string,
  workspaceId: string,
  day: string,
  amountMl: number,
): Promise<WaterDay> {
  return request(fitnessPath(workspaceId, "/water"), {
    method: "POST",
    body: { day, amount_ml: amountMl },
    token,
  });
}

export function deleteWater(
  token: string,
  workspaceId: string,
  entryId: string,
): Promise<WaterDay> {
  return request(fitnessPath(workspaceId, `/water${id(entryId)}`), { method: "DELETE", token });
}

// Activity

export function listActivities(
  token: string,
  workspaceId: string,
  query: { kind?: ActivityKind | null; limit?: number },
  { signal }: Signal = {},
): Promise<ActivityList> {
  return request(fitnessPath(workspaceId, `/activities${toQueryString(query)}`), {
    token,
    signal,
  });
}

export function saveActivity(
  token: string,
  workspaceId: string,
  activityId: string | null,
  body: ActivityRequest,
): Promise<Activity> {
  return activityId === null
    ? request(fitnessPath(workspaceId, "/activities"), { method: "POST", body, token })
    : request(fitnessPath(workspaceId, `/activities${id(activityId)}`), {
        method: "PUT",
        body,
        token,
      });
}

export function deleteActivity(token: string, workspaceId: string, activityId: string) {
  return request<void>(fitnessPath(workspaceId, `/activities${id(activityId)}`), {
    method: "DELETE",
    token,
  });
}

// Goals

export function listGoals(
  token: string,
  workspaceId: string,
  query: Day,
  { signal }: Signal = {},
): Promise<FitnessGoalList> {
  return request(fitnessPath(workspaceId, `/goals${toQueryString(query)}`), { token, signal });
}

export function saveGoal(
  token: string,
  workspaceId: string,
  goalId: string | null,
  body: FitnessGoalRequest,
  today: string,
): Promise<FitnessGoal> {
  const query = toQueryString({ date: today });
  return goalId === null
    ? request(fitnessPath(workspaceId, `/goals${query}`), { method: "POST", body, token })
    : request(fitnessPath(workspaceId, `/goals${id(goalId)}${query}`), {
        method: "PUT",
        body,
        token,
      });
}

export function setGoalStatus(
  token: string,
  workspaceId: string,
  goalId: string,
  status: FitnessGoalStatus,
  today: string,
): Promise<FitnessGoal> {
  return request(
    fitnessPath(workspaceId, `/goals${id(goalId)}/status${toQueryString({ date: today })}`),
    {
      method: "POST",
      body: { status },
      token,
    },
  );
}

export function deleteGoal(token: string, workspaceId: string, goalId: string) {
  return request<void>(fitnessPath(workspaceId, `/goals${id(goalId)}`), {
    method: "DELETE",
    token,
  });
}

export function checkInGoal(
  token: string,
  workspaceId: string,
  goalId: string,
  body: { day: string; value: number; note: string },
  today: string,
): Promise<FitnessGoal> {
  return request(
    fitnessPath(workspaceId, `/goals${id(goalId)}/check-ins${toQueryString({ date: today })}`),
    { method: "POST", body, token },
  );
}

export function deleteCheckIn(
  token: string,
  workspaceId: string,
  goalId: string,
  checkInId: string,
  today: string,
): Promise<FitnessGoal> {
  return request(
    fitnessPath(
      workspaceId,
      `/goals${id(goalId)}/check-ins${id(checkInId)}${toQueryString({ date: today })}`,
    ),
    { method: "DELETE", token },
  );
}

// Habits and calendar

export function listHabitLinks(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<FitnessHabitLinkList> {
  return request(fitnessPath(workspaceId, "/habit-links"), { token, signal });
}

export function saveHabitLink(
  token: string,
  workspaceId: string,
  body: FitnessHabitLinkRequest,
): Promise<FitnessHabitLink> {
  return request(fitnessPath(workspaceId, "/habit-links"), { method: "PUT", body, token });
}

export function deleteHabitLink(token: string, workspaceId: string, habitId: string) {
  return request<void>(fitnessPath(workspaceId, `/habit-links${id(habitId)}`), {
    method: "DELETE",
    token,
  });
}

export function listScheduledWorkouts(
  token: string,
  workspaceId: string,
  query: Range & { timezone?: string | null },
  { signal }: Signal = {},
): Promise<ScheduledWorkoutList> {
  return request(fitnessPath(workspaceId, `/schedule${toQueryString(query)}`), { token, signal });
}

export function scheduleWorkout(
  token: string,
  workspaceId: string,
  body: ScheduleWorkoutRequest,
): Promise<ScheduledWorkout> {
  return request(fitnessPath(workspaceId, "/schedule"), { method: "POST", body, token });
}

/** The workout an event schedules, or `null` when the event isn't one. */
export async function getScheduledWorkout(
  token: string,
  workspaceId: string,
  eventId: string,
  { signal }: Signal = {},
): Promise<ScheduledWorkout | null> {
  try {
    return await request<ScheduledWorkout>(fitnessPath(workspaceId, `/schedule${id(eventId)}`), {
      token,
      signal,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export function linkScheduledWorkout(
  token: string,
  workspaceId: string,
  eventId: string,
  templateId: string | null,
): Promise<ScheduledWorkout> {
  return request(fitnessPath(workspaceId, `/schedule${id(eventId)}`), {
    method: "PUT",
    body: { template_id: templateId },
    token,
  });
}

export function unlinkScheduledWorkout(token: string, workspaceId: string, eventId: string) {
  return request<void>(fitnessPath(workspaceId, `/schedule${id(eventId)}`), {
    method: "DELETE",
    token,
  });
}

export function logWorkout(
  token: string,
  workspaceId: string,
  body: LogWorkoutRequest,
): Promise<Workout> {
  return request(fitnessPath(workspaceId, "/sessions/log"), { method: "POST", body, token });
}
