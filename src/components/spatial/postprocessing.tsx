import type { Quality } from "./performance";
import styles from "./spatial.module.css";
/** Composited depth cues only. No bloom framebuffer or additional GPU renderer. */
export function Postprocessing({ quality }: { quality: Quality }) {
  return (
    <div aria-hidden="true" className={styles.optics} data-quality={quality}>
      <div className={styles.lightBeam} />
      <div className={styles.haze} />
      <div className={styles.vignette} />
    </div>
  );
}
