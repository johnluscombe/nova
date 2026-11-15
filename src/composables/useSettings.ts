import {
    defaultSiddSettings,
    validateSiddSettings,
    type SiddSettings
} from "@/types/sidd";
export { defaultSiddSettings };
import { ref } from "vue";
import {
    defaultFormationSettings,
    validateFormationSettings,
    type FormationSettings
} from "@/types/formation";
export { defaultFormationSettings };

export const defaultPercentiles = [1, 5, 25, 50, 75, 95, 99];
const storageKey = "nova.settings.percentiles";

export function validatePercentiles(value: unknown): number[] {
    if (
        !Array.isArray(value) ||
        !value.length ||
        value.length > 101 ||
        !value.every(
            item =>
                typeof item === "number" &&
                Number.isInteger(item) &&
                item >= 0 &&
                item <= 100
        )
    ) {
        throw new Error("Select at least one percentile from 0 to 100.");
    }
    return [...new Set(value)].sort((a, b) => a - b);
}

function loadPercentiles(): number[] {
    try {
        const saved = localStorage.getItem(storageKey);
        return saved
            ? validatePercentiles(JSON.parse(saved))
            : [...defaultPercentiles];
    } catch {
        return [...defaultPercentiles];
    }
}

export const selectedPercentiles = ref(loadPercentiles());

export function savePercentiles(percentiles: number[]): void {
    const values = validatePercentiles(percentiles);
    localStorage.setItem(storageKey, JSON.stringify(values));
    selectedPercentiles.value = values;
}

export function visibleStatistics(
    statistics: Record<string, string | number | boolean | null>
) {
    return Object.fromEntries(
        Object.entries(statistics).filter(([label]) => {
            const match = /^(\d+)(?:st|nd|rd|th) percentile$/.exec(label);
            return (
                !match || selectedPercentiles.value.includes(Number(match[1]))
            );
        })
    );
}

const formationStorageKey = "nova.settings.formation";
function loadFormationSettings(): FormationSettings {
    try {
        const saved = localStorage.getItem(formationStorageKey);
        return saved
            ? validateFormationSettings(JSON.parse(saved))
            : { ...defaultFormationSettings };
    } catch {
        return { ...defaultFormationSettings };
    }
}
export const formationSettings = ref(loadFormationSettings());
export function saveFormationSettings(value: FormationSettings): void {
    const settings = validateFormationSettings(value);
    localStorage.setItem(formationStorageKey, JSON.stringify(settings));
    formationSettings.value = settings;
}

const siddStorageKey = "nova.settings.sidd";
function loadSiddSettings(): SiddSettings {
    try {
        const saved = localStorage.getItem(siddStorageKey);
        return saved
            ? validateSiddSettings(JSON.parse(saved))
            : { ...defaultSiddSettings };
    } catch {
        return { ...defaultSiddSettings };
    }
}
export const siddSettings = ref(loadSiddSettings());
export function saveSiddSettings(value: SiddSettings): void {
    const settings = validateSiddSettings(value);
    localStorage.setItem(siddStorageKey, JSON.stringify(settings));
    siddSettings.value = settings;
}
