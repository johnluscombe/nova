import type { ImagePlugin } from "../../../src-electron/image-plugins.ts";
export default {
    async executeRibbonAction(actionId, context) {
        switch (actionId) {
            case "about":
                return {
                    message:
                        "This plugin contributes tabs, groups, and buttons to Nova's ribbon."
                };
            case "scenario-info":
            case "check":
                return { message: `Active scenario: ${context.scenarioPath}` };
            default:
                throw new Error("Unknown example action.");
        }
    }
} satisfies ImagePlugin;
