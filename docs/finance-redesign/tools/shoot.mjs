// Screenshot every Finance tab at several widths through the Chrome DevTools protocol.
// Usage: node shoot.mjs <session.json> <outDir> [theme]
// Env: WIDTHS=390,1280,2560 and TABS=Overview,Budgets,… narrow the run. Needs the web app on :3100.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [sessionFile, outDir, theme = "light"] = process.argv.slice(2);
const session = JSON.parse(readFileSync(sessionFile, "utf8"));
mkdirSync(outDir, { recursive: true });

const ORIGIN = "http://localhost:3100";
const PORT = 9333;
const WIDTHS = (process.env.WIDTHS ?? "390,1280,2560").split(",").map(Number);
const TABS = (
  process.env.TABS ??
  "Overview,Budgets,Plan,Goals,Upcoming,Transactions,Accounts,Loans,Subscriptions,Bills,Investments,Assets,Net worth"
).split(",");

const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(tmpdir(), "orbit-finance-shots-chrome")}`,
    "--hide-scrollbars",
    "--no-first-run",
    "about:blank",
  ],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    target = list.find((t) => t.type === "page");
  } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let nextId = 1;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (msg) =>
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result),
    );
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result
    .value;

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1280,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.navigate", { url: `${ORIGIN}/` });
await sleep(1500);
await evaluate(
  `localStorage.setItem("orbit:session", ${JSON.stringify(JSON.stringify(session))});` +
    `localStorage.setItem("theme", ${JSON.stringify(theme)}); true`,
);

const waitIdle = async () => {
  // Wait until no skeletons or loading text remain, then a beat for motion to settle.
  for (let i = 0; i < 40; i++) {
    const busy = await evaluate(
      `!!document.querySelector('[aria-busy="true"], .animate-pulse') || /Loading/.test(document.querySelector('main')?.innerText ?? 'Loading')`,
    );
    if (!busy) break;
    await sleep(250);
  }
  await sleep(600);
};

for (const width of WIDTHS) {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height: width < 600 ? 844 : width > 2000 ? 1440 : 900,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
  for (const tab of TABS) {
    // Each view has its own URL (`?view=net-worth`); the overview is the page itself.
    const view = tab.toLowerCase().replace(/\s+/g, "-");
    const url = view === "overview" ? `${ORIGIN}/finance` : `${ORIGIN}/finance?view=${view}`;
    await send("Page.navigate", { url });
    await sleep(1200);
    await waitIdle();
    const height = await evaluate(`Math.ceil(document.documentElement.scrollHeight)`);
    const shot = await send("Page.captureScreenshot", {
      format: "webp",
      quality: 80,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height: Math.min(height, 12000), scale: 1 },
    });
    const name = `${tab.toLowerCase().replace(/\s+/g, "-")}-${width}${theme === "dark" ? "-dark" : ""}.webp`;
    writeFileSync(join(outDir, name), Buffer.from(shot.data, "base64"));
    console.log(name, height);
  }
}
ws.close();
chrome.kill();
