"use client";

import { useCaptureFlow } from "@/lib/capture-flow-context";
import { CreateSheet } from "@/components/create-sheet/CreateSheet";
import { VoiceFlow } from "@/components/capture-flow/VoiceFlow";
import { TextFlow } from "@/components/capture-flow/TextFlow";
import { ProcessingView } from "@/components/capture-flow/ProcessingView";
import { SuccessView } from "@/components/capture-flow/SuccessView";
import { EmptyResultView } from "@/components/capture-flow/EmptyResultView";
import { ErrorResultView } from "@/components/capture-flow/ErrorResultView";

export function CaptureFlow() {
  const { stage, close } = useCaptureFlow();

  return (
    <>
      <div className={`backdrop${stage === "choice" ? " open" : ""}`} onClick={close} aria-hidden={stage !== "choice"}>
        <div className="sheet" onClick={(e) => e.stopPropagation()}>
          <CreateSheet />
        </div>
      </div>
      {stage === "voice" && <VoiceFlow />}
      {stage === "text" && <TextFlow />}
      {stage === "processing" && (
        <div className="flow"><div className="flow-body"><ProcessingView /></div></div>
      )}
      {stage === "success" && (
        <div className="flow"><div className="flow-body"><SuccessView /></div></div>
      )}
      {stage === "empty" && (
        <div className="flow"><div className="flow-body"><EmptyResultView /></div></div>
      )}
      {stage === "error" && (
        <div className="flow"><div className="flow-body"><ErrorResultView /></div></div>
      )}
    </>
  );
}
