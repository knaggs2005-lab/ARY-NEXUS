"use client";
import { useEffect, useState } from "react";
import {
  defaultLocations,
  type StudioDevice,
  type StudioLocation,
  type Observation,
} from "../../domain/studio";
import styles from "./studio.module.css";

/** Positions are owner-supplied percentages; fallback layout is explicitly schematic. */
export function StudioSpace({
  devices,
  observations,
  locations = defaultLocations,
}: {
  devices: StudioDevice[];
  observations: Observation[];
  locations?: StudioLocation[];
}) {
  const [location, setLocation] = useState(locations[0]?.id ?? "studio");
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const visible = devices.filter(
    (d) => (d.location_id ?? "studio") === location,
  );
  const device = visible.find((d) => d.id === selected);
  const state = (id: string) => {
    const o = observations.find((o) => o.device_id === id);
    return !o
      ? "unknown"
      : now - Date.parse(o.observed_at) > 30000
        ? "stale"
        : o.status;
  };
  return (
    <section className={styles.space} aria-label="Physical World spatial view">
      <div className={styles.locations} aria-label="Locations">
        {locations.map((l) => (
          <button
            key={l.id}
            aria-pressed={location === l.id}
            onClick={() => {
              setLocation(l.id);
              setSelected(null);
            }}
          >
            {l.name}
          </button>
        ))}
      </div>
      <div className={styles.floor} aria-label="Device positions">
        <span className={styles.roomLabel}>
          PHYSICAL WORLD / {locations.find((l) => l.id === location)?.name}
        </span>
        {!visible.length && (
          <p className={styles.emptyRoom}>
            No configured devices at this location.
          </p>
        )}
        {visible.map((d, i) => (
          <button
            key={d.id}
            className={styles.deviceNode}
            data-status={state(d.id)}
            style={{
              left: `${d.position?.x ?? 18 + (i % 4) * 21}%`,
              top: `${d.position?.y ?? 25 + Math.floor(i / 4) * 14}%`,
            }}
            aria-pressed={selected === d.id}
            onClick={() => setSelected(d.id)}
          >
            <span className={styles.stateDot} aria-hidden="true" />
            <strong>{d.name}</strong>
            <small>
              {d.kind} · {state(d.id)}
            </small>
          </button>
        ))}
      </div>
      <p className={styles.foot}>
        Schematic placement unless configured. State expires after 30 seconds;
        Inspect studio refreshes through the permissioned action system.
      </p>
      {device && (
        <aside
          className={styles.deviceDetail}
          aria-label="Selected device telemetry"
        >
          <h3>{device.name}</h3>
          <p>
            {device.adapter} · {state(device.id)}
          </p>
          {observations
            .filter((o) => o.device_id === device.id)
            .map((o) => (
              <div key={o.device_id}>
                <p>{o.detail}</p>
                <time>{new Date(o.observed_at).toLocaleString()}</time>
                <dl>
                  {Object.entries(o.state).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{String(v)}</dd>
                    </div>
                  ))}
                </dl>
                {o.recovery && (
                  <p>
                    One safe inspection retry was attempted. No physical write
                    was replayed.
                  </p>
                )}
              </div>
            ))}
        </aside>
      )}
    </section>
  );
}
