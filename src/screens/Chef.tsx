import { ComingInPhase, Page } from '../components/ui'

export default function ChefScreen() {
  return (
    <Page title="Chef">
      <ComingInPhase phase={6} what="Personal chef commands, such as swapping a meal, making tomorrow a rest day, or using up what expires soon. They are understood on the phone by a rule-based interpreter: no AI service, no internet." />
    </Page>
  )
}
