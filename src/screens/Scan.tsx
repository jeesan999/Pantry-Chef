import { ComingInPhase, Page } from '../components/ui'

export default function ScanScreen() {
  return (
    <Page title="Scan Receipt">
      <ComingInPhase phase={3} what="Photograph a receipt; it is read on your phone (no upload), every line is shown for you to check, and one confirm adds the items to your pantry, expenses and price history. Duplicate receipts are blocked.">
        <p className="mt-2 text-sm text-stone-600">Please gather 5–10 photos of real receipts from the stores you use, with loyalty card numbers covered, for Phase 3 testing.</p>
      </ComingInPhase>
    </Page>
  )
}
