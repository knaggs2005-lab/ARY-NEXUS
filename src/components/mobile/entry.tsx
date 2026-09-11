"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
const Desktop = dynamic(() =>
  import("../spatial/spatial-shell").then((m) => m.SpatialShell),
);
/** Select once on entry; resizing never discards a live conversation. Explicit Systems always wins. */
export function ApplicationEntry() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    if (
      window.matchMedia("(max-width: 680px)").matches &&
      !new URLSearchParams(location.search).has("systems")
    )
      location.replace("/mobile");
    else setDesktop(true);
  }, []);
  return desktop ? (
    <Desktop />
  ) : (
    <main
      style={{
        background: "#080c13",
        color: "#e7edf6",
        minHeight: "100dvh",
        padding: 30,
      }}
      role="status"
    >
      Opening Ary…
    </main>
  );
}
