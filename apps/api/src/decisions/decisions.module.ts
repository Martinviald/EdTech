import { Global, Module } from '@nestjs/common';
import { JevDecisionEngine, OpenAiDecisionEngine } from '@soe/decisions';
import { LLM_PROVIDER_DEFAULTS } from '../llm/llm.constants';
import { DecisionCallsRecorder } from './decision-calls.recorder';
import { DECISION_ENGINES } from './decisions.constants';
import { DecisionsConfigService } from './decisions-config.service';
import { DecisionsService } from './decisions.service';

@Global()
@Module({
  providers: [
    DecisionsConfigService,
    DecisionCallsRecorder,
    {
      provide: DECISION_ENGINES,
      useFactory: () => [
        new JevDecisionEngine(),
        new OpenAiDecisionEngine({ apiKey: process.env[LLM_PROVIDER_DEFAULTS.openai.apiKeyEnv] }),
      ],
    },
    DecisionsService,
  ],
  exports: [DecisionsService],
})
export class DecisionsModule {}
