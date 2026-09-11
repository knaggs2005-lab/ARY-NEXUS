import type { Quality } from "./performance";
import styles from "./spatial.module.css";
export function PerformanceControls({
  flat,
  onFlat,
  tracking,
  onTracking,
  hud,
  onHud,
  reduced,
  onReduced,
  quality,
  onQuality,
  onClassic,
  diagnostics,
  trackingStatus,
}: {
  flat: boolean;
  onFlat: () => void;
  tracking: boolean;
  onTracking: () => void;
  hud: boolean;
  onHud: () => void;
  reduced: boolean;
  onReduced: () => void;
  quality: string;
  onQuality: (value: "auto" | Quality) => void;
  onClassic: () => void;
  diagnostics: string;
  trackingStatus: string;
}) {
  return (
    <details className={styles.controls}>
      <summary>View controls{tracking ? " · Tracking enabled" : ""}</summary>
      <div>
        <output aria-label="Rendering diagnostics">{diagnostics}</output>
        <output aria-label="Hand tracking status">
          Tracking: {trackingStatus}
        </output>
        <button aria-pressed={flat} onClick={onFlat}>
          2D mode
        </button>
        <button aria-pressed={tracking} onClick={onTracking}>
          {tracking ? "Disable hand tracking" : "Enable hand tracking"}
        </button>
        <button aria-pressed={hud} onClick={onHud}>
          {hud ? "Hide HUD" : "Show HUD"}
        </button>
        <button aria-pressed={reduced} onClick={onReduced}>
          Reduce motion
        </button>
        <label>
          Effect quality
          <select
            value={quality}
            onChange={(e) => onQuality(e.target.value as "auto" | Quality)}
          >
            <option value="auto">Adaptive</option>
            <option value="high">High</option>
            <option value="balanced">Balanced</option>
            <option value="low">Low</option>
          </select>
        </label>
        <button onClick={onClassic}>Classic workspace</button>
        <p>
          Camera stays off until enabled. Frames stay on this device. Circle
          activation is reserved.
        </p>
      </div>
    </details>
  );
}
