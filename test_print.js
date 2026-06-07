import { chromium } from "playwright";

const PORT = 58654;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

// Capture console messages
const logs = [];
page.on("console", (msg) => logs.push(msg.text()));

await page.goto(`http://localhost:${PORT}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500); // Let charts render

// Override print before clicking export
await page.evaluate(() => {
  window.print = () => console.log("[TEST] print() called - suppressed");
});

// Check initial chart data
const before = await page.evaluate(() => {
  // The state object is in a closure, but we can check the canvas
  // Let's try to find the chart instance another way
  const canvas = document.getElementById("chart-top-contributors");
  const chart = canvas ? Chart.getChart(canvas) : null;
  return chart ? chart.data.labels.length : null;
});
console.log("Before print — top contributors count:", before);

// Check file table
const filesBefore = await page.evaluate(() => {
  const rows = document.querySelectorAll("#topfiles-table tbody tr");
  return rows.length;
});
console.log("Before print — top files count:", filesBefore);

// Click the export button to trigger the print flow
await page.click("#export-pdf");
await page.waitForTimeout(500);

// Check after print flow (printing class is still on, charts re-rendered)
const after = await page.evaluate(() => {
  const canvas = document.getElementById("chart-top-contributors");
  const chart = canvas ? Chart.getChart(canvas) : null;
  return chart ? chart.data.labels.length : null;
});
console.log("After print flow — top contributors count:", after);

const filesAfter = await page.evaluate(() => {
  const rows = document.querySelectorAll("#topfiles-table tbody tr");
  return rows.length;
});
console.log("After print flow — top files count:", filesAfter);

// Show all debug logs
console.log("\n--- Console logs ---");
logs.forEach((l) => console.log(l));

browser.close();
