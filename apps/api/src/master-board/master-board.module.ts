import { Module } from '@nestjs/common';
import { MasterBoardController } from './master-board.controller';
import { MasterBoardService } from './master-board.service';

@Module({
  controllers: [MasterBoardController],
  providers: [MasterBoardService],
  exports: [MasterBoardService],
})
export class MasterBoardModule {}
