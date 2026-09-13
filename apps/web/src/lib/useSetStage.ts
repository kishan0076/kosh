import { useCallback } from "react";
import type { Stage } from "@kosh/shared";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";

/** Set an item's stage — but "dropped" first prompts for a verdict (§7). */
export function useSetStage() {
  const setStage = useData((s) => s.setStage);
  const openVerdict = useUi((s) => s.openVerdict);
  return useCallback(
    (id: string, stage: Stage) => {
      if (stage === "dropped") openVerdict(id);
      else setStage(id, stage);
    },
    [setStage, openVerdict],
  );
}
