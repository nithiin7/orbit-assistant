/** Areas a new user can choose to set up; each adds one step to the setup guide. */
export const SETUP_AREAS = [
  {
    value: "finance",
    label: "Money",
    description: "Accounts, budgets, and investments.",
  },
  {
    value: "health",
    label: "Health",
    description: "Units, height, and daily targets. Private to you.",
  },
  {
    value: "connect",
    label: "Google or Microsoft",
    description: "Calendar, mail, and files from your accounts.",
  },
  {
    value: "ai",
    label: "AI assistant",
    description: "Answers and summaries from a provider you choose.",
  },
] as const;

export type SetupArea = (typeof SETUP_AREAS)[number]["value"];

export type SetupStep = "profile" | "appearance" | "areas" | SetupArea | "done";

const ALL_STEPS: readonly SetupStep[] = [
  "profile",
  "appearance",
  "areas",
  "finance",
  "health",
  "connect",
  "ai",
  "done",
];

export const ALL_AREAS: readonly SetupArea[] = SETUP_AREAS.map((area) => area.value);

/** The steps shown for the chosen areas, in order. */
export function setupSteps(areas: readonly SetupArea[]): SetupStep[] {
  return ALL_STEPS.filter(
    (step) => !ALL_AREAS.includes(step as SetupArea) || areas.includes(step as SetupArea),
  );
}

/** A `?step=` value from the address, or the first step when it isn't one. */
export function parseSetupStep(value: string | null): SetupStep {
  return ALL_STEPS.find((step) => step === value) ?? "profile";
}

export const SETUP_PATH = "/welcome";

/** Where the setup guide's connect step lives, for returning after a provider's consent page. */
export const SETUP_CONNECT_PATH = `${SETUP_PATH}?step=connect`;
