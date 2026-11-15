import { test, expect } from "./fixtures";
import { collectCoverage } from "./coverage";

test("startup reports plugin discovery and session restoration errors", async ({
    application
}) => {
    const page = await application.firstWindow();

    await expect(
        page.getByRole("button", { name: "New", exact: true })
    ).toBeEnabled();
    await application.evaluate(({ BrowserWindow }) => {
        const ipc = BrowserWindow.getAllWindows()[0]!.webContents.ipc;

        for (const channel of ["image:plugins", "scenario:restore-last"]) {
            ipc.removeHandler(channel);
            ipc.handle(channel, () => {
                throw new Error("Session unavailable");
            });
        }
    });
    await collectCoverage(application);
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("Session unavailable");
    await expect(
        page.getByRole("button", { name: "Add Image", exact: true })
    ).toBeDisabled();
});

test("unknown routes redirect to the workspace", async ({ application }) => {
    const page = await application.firstWindow();

    await expect(
        page.getByRole("button", { name: "New", exact: true })
    ).toBeEnabled();
    await page.evaluate(() => {
        window.location.hash = "/missing-route";
    });
    await expect(
        page.getByRole("button", { name: "New", exact: true })
    ).toBeVisible();
    await expect
        .poll(() => page.evaluate(() => window.location.hash))
        .toBe("#/");
});
