import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class FetchCompanyJobPostsDto {
  @IsString()
  companyName!: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxItems?: number;

  @IsOptional()
  @IsIn(['relevance', 'date'])
  sort?: 'relevance' | 'date';

  @IsOptional()
  @IsIn(['any', '1', '3', '7', '14'])
  fromDays?: 'any' | '1' | '3' | '7' | '14';

  @IsOptional()
  @IsIn(['basic', 'detailed', 'rich'])
  searchMode?: 'basic' | 'detailed' | 'rich';
}
