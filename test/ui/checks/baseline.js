// Runner self-test: passes on any build where the app boots with seed data.
(() => ({
  booted: typeof data !== "undefined" && data.length > 0,
  hasLogPanel: !!document.querySelector("#log"),
  seedLoaded: data.some((e) => e.l === "Serie V Melanio Maduro"),
}))()
