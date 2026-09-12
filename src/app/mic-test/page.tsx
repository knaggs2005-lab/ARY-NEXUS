import { notFound } from "next/navigation";
import { LocalVoiceSetup } from "../../components/voice/local-voice-setup";
import MicTestHarness from "../../components/voice/mic-test-harness";

export default function MicTestPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <>
      <MicTestHarness />
      <LocalVoiceSetup
        wakeEnabled={process.env.ARY_WAKE_WORD_ENABLED === "true"}
      />
    </>
  );
}
