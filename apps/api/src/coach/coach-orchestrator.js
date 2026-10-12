import { classifyB3 } from "./classification/b3-preclassifier.js";
import { classifySemanticIntent } from "./classification/semantic-intent-classifier.js";
import { resolveFinalIntent } from "./classification/resolve-final-intent.js";

export async function runCoachDecision(
  message,
  context = {},
  permissions = {},
  classifySemanticIntent,
) {
  const preDecision = classifyB3(message, context);
  const semanticDecision = await classifySemanticIntent(
    message,
    context,
    classifySemanticIntent,
  );
  const finalDecision = resolveFinalIntent(
    preDecision,
    semanticDecision,
    permissions,
    context,
  );

  return {
    preDecision,
    semanticDecision,
    finalDecision,
  };
}
