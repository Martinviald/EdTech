import { Global, Module } from '@nestjs/common';
import { JevDecisionEngine } from '@soe/decisions';
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
      useFactory: () => [new JevDecisionEngine()],
    },
    DecisionsService,
  ],
  exports: [DecisionsService],
})
export class DecisionsModule {}
