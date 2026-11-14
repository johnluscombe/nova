// Test-only entry: isolate preferences before the production main module starts.
const { app } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

app.setAppPath(process.cwd());
app.setPath("userData", process.env.NOVA_TEST_PROFILE);
void import(pathToFileURL(path.resolve("electron-main.js")).href);
