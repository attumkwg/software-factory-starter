import { PMF_SURVEY_LABELS, PMF_SURVEY_QUESTION, type PmfSurveyAnswer } from "@app/shared";
import { Button, Card, Heading, Inline, Muted, Stack } from "@app/ui";
import { api } from "../api.ts";
import { useAction } from "../use-action.ts";

// 「このサービスが使えなくなったら、どう感じますか」(PMF の兆し。docs/specs/0046-pmf-survey.md)。
// 出すかは API が決める(機能フラグ・使い始めて14日・四半期に1回)。答えるか「答えない」を押すと、その回はもう出ない。
// 答えは数だけを数える(だれが何と答えたかは残らない)と、画面にも書く。
const CHOICES = Object.entries(PMF_SURVEY_LABELS) as [
  Exclude<PmfSurveyAnswer, "skipped">,
  string,
][];

export function PmfSurvey() {
  const answering = useAction();
  const send = (answer: PmfSurveyAnswer, success: string) =>
    answering.run(() => api.answerPmfSurvey(answer), { success });
  return (
    <section aria-labelledby="pmf-survey-question">
      <Card>
        <Stack gap={3}>
          <Heading level={2}>
            <span id="pmf-survey-question">{PMF_SURVEY_QUESTION}</span>
          </Heading>
          <Muted>1つ選んでください。答えは数だけを数えます(だれが何と答えたかは残りません)。</Muted>
          <Inline gap={2}>
            {CHOICES.map(([answer, label]) => (
              <Button
                key={answer}
                variant="secondary"
                isDisabled={answering.pending}
                onPress={() => send(answer, "答えてくださって、ありがとうございました")}
              >
                {label}
              </Button>
            ))}
            <Button
              variant="ghost"
              isDisabled={answering.pending}
              onPress={() => send("skipped", "今回は聞きません")}
            >
              答えない
            </Button>
          </Inline>
        </Stack>
      </Card>
    </section>
  );
}
