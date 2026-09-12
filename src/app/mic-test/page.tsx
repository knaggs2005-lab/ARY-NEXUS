import { notFound } from "next/navigation";
import MicTestHarness from "../../components/voice/mic-test-harness";

export default function MicTestPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <MicTestHarness />;
}
