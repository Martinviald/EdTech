import { Module } from '@nestjs/common';
import { BenchmarkingModule } from '../benchmarking/benchmarking.module';
import { MasterBoardController } from './master-board.controller';
import { MasterBoardService } from './master-board.service';

@Module({
  imports: [BenchmarkingModule],
  controllers: [MasterBoardController],
  providers: [MasterBoardService],
  exports: [MasterBoardService],
})
export class MasterBoardModule {}
