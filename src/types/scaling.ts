export const scalingOptions = [
    { value: "amplitude", label: "Amplitude" },
    { value: "real", label: "Real" },
    { value: "imaginary", label: "Imaginary" },
    { value: "phase", label: "Phase (degrees)" },
    { value: "power", label: "Linear power" },
    { value: "log-power", label: "Log power (dB)" },
    { value: "relative-power", label: "Relative power (dB, peak = 0)" },
    { value: "rcs", label: "RCS (m²)" },
    { value: "rcs-db", label: "RCS (dBsm)" },
    { value: "sigma-zero", label: "Sigma-zero (linear)" },
    { value: "sigma-zero-db", label: "Sigma-zero (dB)" },
    { value: "beta-zero", label: "Beta-zero (linear)" },
    { value: "beta-zero-db", label: "Beta-zero (dB)" },
    { value: "gamma-zero", label: "Gamma-zero (linear)" },
    { value: "gamma-zero-db", label: "Gamma-zero (dB)" }
] as const;

/**
 * A supported scalar representation of source samples. Availability depends on
 * the decoder and calibration metadata.
 */
export type Scaling = (typeof scalingOptions)[number]["value"];

/**
 * Active-image scaling choices, current selection, and pending rescale state
 * for the ribbon.
 */
export interface ScalingState {
    options: Scaling[];

    value: Scaling;

    loading: boolean;
}

/**
 * Narrow an unknown value to one of the supported scientific sample
 * scaling modes.
 */
export function isScaling(value: unknown): value is Scaling {
    return scalingOptions.some(option => option.value === value);
}
