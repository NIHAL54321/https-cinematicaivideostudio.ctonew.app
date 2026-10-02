import { Suspense } from "react";
import { PageHeader } from "@/components/ui";
import { CreateVideoWizard } from "@/components/create-video/wizard";
export const metadata = { title: "Create Video" };
/**
 * The Create Video wizard — the Phase 2 entry flow (IDEA → SCRIPT → STORY →
 * STORYBOARD). 8 steps, then a real project + honest AI stop.
 *
 * `?mode=faceless` (linked from the dashboard Faceless Mode card) pre-selects
 * the "faceless-creator" style. useSearchParams needs a Suspense boundary.
 */
export default function CreateVideoPage() {
  return (
    <div>
      <PageHeader
        title="Create Video"
        description="One idea → a complete structure plan in minutes. Script and visuals follow once AI providers are connected."
      />
      <Suspense>
        <CreateVideoWizard />
      </Suspense>
    </div>
  );
}
