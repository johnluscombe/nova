import { ref } from "vue";

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
