"use client";
import { useEffect, useRef, type ReactNode } from "react";
import styles from "./nexus.module.css";

export function NexusSurface({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <section className={styles.surface} aria-label={label}>
      {children}
    </section>
  );
}
export function NexusState({
  title,
  children,
  error = false,
  action,
}: {
  title: string;
  children?: ReactNode;
  error?: boolean;
  action?: ReactNode;
}) {
  return (
    <section className={styles.state} role={error ? "alert" : "status"}>
      <span
        className={styles.stateRule}
        data-error={error}
        aria-hidden="true"
      />
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </section>
  );
}
export { AryObject as AryPresence } from "../presence/ary-object";
/** Native dialog supplies focus containment; closing restores its invoker. No action approval semantics here. */
export function NexusDrawer({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) {
      previous.current = document.activeElement as HTMLElement;
      dialog.current?.showModal();
      close.current?.focus();
    } else if (dialog.current?.open) {
      dialog.current.close();
      previous.current?.focus({ preventScroll: true });
    }
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className={styles.drawer}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button ref={close} onClick={onClose}>
          Close
        </button>
      </header>
      <div className={styles.drawerBody}>{children}</div>
    </dialog>
  );
}
