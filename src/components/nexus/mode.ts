"use client";
import { createContext, useContext } from "react";
export const NexusModeContext = createContext<"ambient" | "systems">("ambient");
export const useNexusMode = () => useContext(NexusModeContext);
