import { ref } from "vue";
import type { ScenarioInfo } from "@/types/scenario";

export const activeScenario = ref<ScenarioInfo | null>(null);
