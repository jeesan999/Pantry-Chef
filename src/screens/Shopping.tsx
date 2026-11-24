import { ComingInPhase, Page } from '../components/ui'

export default function ShoppingScreen() {
  return (
    <Page title="Shopping List">
      <ComingInPhase phase={5} what="Built from the week's meal plan minus what is already in your pantry, with estimated cost per item from your own price history. Tick items off as you shop." />
    </Page>
  )
}
