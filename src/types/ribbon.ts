/**
 * A declared plugin action; its identifier is passed to the plugin action
 * handler.
 */
export interface RibbonButton {
    id: string;

    label: string;

    /** Optional Quasar/Material icon name. */
    icon?: string;

    /** Disable this action when there is no active scenario. */
    requiresScenario?: boolean;
}

/** A labeled collection of plugin action buttons within a ribbon tab. */
export interface RibbonGroup {
    id: string;

    label: string;

    buttons: RibbonButton[];
}

/** A plugin-provided ribbon tab containing ordered action groups. */
export interface RibbonTab {
    id: string;

    label: string;

    groups: RibbonGroup[];
}

/** Optional manifest contribution describing plugin-specific ribbon tabs. */
export interface PluginRibbon {
    tabs: RibbonTab[];
}

/** Host context supplied when invoking a plugin ribbon action. */
export interface RibbonActionContext {
    /** Active scenario path, or null when no scenario file is open. */
    scenarioPath: string | null;
}

/** Optional user-facing feedback returned after a plugin action completes. */
export interface RibbonActionResult {
    message?: string;
}

/**
 * Validate plugin tab, group, and action definitions, rejecting duplicate
 * identifiers.
 */
export function validateRibbon(value: unknown): PluginRibbon {
    const ribbon = value as PluginRibbon;

    /**
     * Check a ribbon identifier against the supported lowercase naming
     * convention.
     */
    const identifier = (value: unknown) =>
        typeof value === "string" && /^[a-z][a-z0-9-]*$/.test(value);

    /**
     * Require a nonempty, bounded ribbon label.
     */
    const label = (value: unknown) =>
        typeof value === "string" && !!value.trim() && value.length <= 100;

    if (!ribbon || !Array.isArray(ribbon.tabs) || ribbon.tabs.length > 20) {
        throw new Error("Invalid ribbon tabs.");
    }

    const tabs = new Set<string>();
    const actions = new Set<string>();

    for (const tab of ribbon.tabs) {
        if (
            !tab ||
            !identifier(tab.id) ||
            !label(tab.label) ||
            tabs.has(tab.id) ||
            !Array.isArray(tab.groups) ||
            tab.groups.length > 30
        ) {
            throw new Error("Invalid or duplicate ribbon tab.");
        }

        tabs.add(tab.id);

        const groups = new Set<string>();

        for (const group of tab.groups) {
            if (
                !group ||
                !identifier(group.id) ||
                !label(group.label) ||
                groups.has(group.id) ||
                !Array.isArray(group.buttons) ||
                group.buttons.length > 50
            ) {
                throw new Error("Invalid or duplicate ribbon group.");
            }

            groups.add(group.id);

            for (const button of group.buttons) {
                if (
                    !button ||
                    !identifier(button.id) ||
                    !label(button.label) ||
                    actions.has(button.id) ||
                    (button.icon !== undefined &&
                        (typeof button.icon !== "string" ||
                            !/^[a-z0-9_]+$/.test(button.icon))) ||
                    (button.requiresScenario !== undefined &&
                        typeof button.requiresScenario !== "boolean")
                ) {
                    throw new Error("Invalid or duplicate ribbon button.");
                }

                actions.add(button.id);
            }
        }
    }

    return ribbon;
}
