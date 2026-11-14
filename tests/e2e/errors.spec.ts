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
        page.getByRole("button", { name: "Open image", exact: true })
    ).toBeDisabled();
});

test("unknown routes offer recovery to the workspace", async ({
    application
}) => {
    const page = await application.firstWindow();
    await expect(
        page.getByRole("button", { name: "New", exact: true })
    ).toBeEnabled();
    await page.evaluate(() => {
        window.location.hash = "/missing-route";
    });
    await expect(page.getByText("Oops. Nothing here...")).toBeVisible();
    await page.getByRole("link", { name: "Go Home" }).click();
    await expect(
        page.getByRole("button", { name: "New", exact: true })
    ).toBeVisible();
    await page.evaluate(() => {
        window.location.hash = "/second";
    });
    await page.getByRole("link", { name: "Go to Index Page" }).click();
    await expect(
        page.getByRole("button", { name: "New", exact: true })
    ).toBeVisible();
});
