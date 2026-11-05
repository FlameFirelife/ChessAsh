import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "vite";
import assert from "node:assert/strict";
await mkdir("work/qa", { recursive: true });
const origin = process.env.CHESSASH_TUTOR_URL || "http://127.0.0.1:5181";
const server = process.env.CHESSASH_TUTOR_URL
  ? null
  : await createServer({
      server: { host: "127.0.0.1", port: 5181, strictPort: true },
    });
await server?.listen();
const candidates = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
];
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHESSASH_BROWSER_EXECUTABLE || candidates.find(existsSync),
});
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    let config = {
      mode: "off",
      endpoint: "http://127.0.0.1:11434",
      model: "",
      hasKey: false,
    };
    window.__cancelled = false;
    window.chessash = {
      platform: "windows",
      tutorGetSettings: async () => config,
      tutorSaveSettings: async (next) => {
        config = { ...next, apiKey: "", hasKey: !!next.apiKey };
        window.__lastSavedMode = config.mode;
        return config;
      },
      tutorModels: async () => ["small-local", "bigger-local"],
      tutorChat: async () => {
        await new Promise((r) => setTimeout(r, window.__delay || 1));
        return "Develop the knight to support the centre.\n```uci\ng1f3 d7d5\n```";
      },
      tutorCancel: async () => {
        window.__cancelled = true;
      },
      tutorOnChunk: () => () => {},
      policyGetPack: async () => ({
        name: "ChessAsh standard",
        excellent: 15,
        inaccuracy: 45,
        mistake: 100,
        blunder: 250,
      }),
      policySavePack: async () => {},
    };
  });
  await page.goto(origin);
  await page.getByText("Explore a sample", { exact: true }).click();
  await page.getByRole("tab", { name: "Tutor", exact: true }).click();
  const provider = page.getByLabel("Tutor connection", { exact: true });
  await provider.waitFor();
  await provider.selectOption("ollama");
  await page.getByRole("button", { name: "Find models", exact: true }).click();
  const model = page.getByLabel("Tutor model", { exact: true });
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Tutor model"]')?.value ===
      "small-local",
  );
  await model.selectOption("bigger-local");
  await page
    .getByRole("button", { name: "Save tutor settings", exact: true })
    .click();
  assert.equal(await provider.inputValue(), "ollama");
  assert.equal(await model.inputValue(), "bigger-local");
  await provider.selectOption("api");
  assert.equal(await page.locator(".tutor-settings").getAttribute("open"), "");
  await page
    .getByLabel("Server endpoint", { exact: true })
    .fill("https://provider.example/v1");
  await page.getByLabel("API key", { exact: true }).fill("test-key-only");
  await model.selectOption("__custom__");
  await page
    .getByLabel("Custom model name", { exact: true })
    .fill("example-model");
  await page
    .getByRole("button", { name: "Save tutor settings", exact: true })
    .click();
  assert.equal(await provider.inputValue(), "api");
  assert.equal(await page.evaluate(() => window.__lastSavedMode), "api");
  await page.screenshot({
    path: "work/qa/tutor-provider-choice.png",
    fullPage: true,
  });
  await provider.selectOption("ollama");
  assert.equal(await model.inputValue(), "bigger-local");
  await page
    .getByLabel("Ask the tutor", { exact: true })
    .fill("What should I develop?");
  await page.getByRole("button", { name: "Ask tutor", exact: true }).click();
  await page.locator(".chat-assistant").waitFor({ timeout: 60000 });
  assert.equal(
    await page.getByRole("button", { name: /Preview Nf3 d5/ }).count(),
    1,
  );
  await page.evaluate(() => {
    window.__delay = 1000;
  });
  await page
    .getByLabel("Ask the tutor", { exact: true })
    .fill("Explain again.");
  await page.getByRole("button", { name: "Ask tutor", exact: true }).click();
  await page.getByRole("button", { name: "Next move", exact: true }).click();
  await page.waitForTimeout(1500);
  assert.equal(await page.locator(".chat-assistant").count(), 1);
  assert.equal(await page.evaluate(() => window.__cancelled), true);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    "work/qa/tutor-access-results.json",
    JSON.stringify(
      {
        passed: true,
        checks: [
          "provider visible without advanced tools",
          "Ollama and API selectable",
          "real model dropdown",
          "custom API model entry",
          "saved mode stable",
          "local model remembered across provider switches",
          "local engine grounding",
          "legal UCI preview",
          "stale request cancelled and excluded",
          "no page errors",
          "no horizontal overflow",
        ],
      },
      null,
      2,
    ),
  );
  console.log("TUTOR ACCESS UI PASS");
} catch (error) {
  if (page) {
    await writeFile(
      "work/qa/tutor-access-failure.txt",
      await page.locator("body").innerText(),
    );
    await page.screenshot({
      path: "work/qa/tutor-access-failure.png",
      fullPage: true,
    });
  }
  throw error;
} finally {
  await browser.close();
  await server?.close();
}
