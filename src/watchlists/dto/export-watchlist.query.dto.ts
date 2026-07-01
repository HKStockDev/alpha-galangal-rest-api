import { IsIn } from 'class-validator';

export class ExportWatchlistQueryDto {
  @IsIn(['csv'])
  format!: 'csv';
}
