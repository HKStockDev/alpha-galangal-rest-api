import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  PROMPT_CHANNELS,
  PROMPT_POST_KINDS,
  PROMPT_PURPOSES,
  PROMPT_ROLES,
} from '../prompt-constants';

export class ListPromptTemplatesQueryDto {
  @IsOptional()
  @IsIn([...PROMPT_CHANNELS])
  channel?: string;

  @IsOptional()
  @IsIn([...PROMPT_POST_KINDS])
  post_kind?: string;

  @IsOptional()
  @IsIn([...PROMPT_PURPOSES])
  purpose?: string;

  @IsOptional()
  @IsIn([...PROMPT_ROLES])
  prompt_role?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreatePromptTemplateDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  template_key!: string;

  @IsOptional()
  @IsIn([...PROMPT_CHANNELS])
  channel?: string;

  @IsOptional()
  @IsIn([...PROMPT_POST_KINDS])
  post_kind?: string;

  @IsIn([...PROMPT_PURPOSES])
  purpose!: string;

  @IsIn([...PROMPT_ROLES])
  prompt_role!: string;

  @IsString()
  @MinLength(10)
  template_text!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  required_context_keys?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  change_note?: string;
}

export class UpdatePromptTemplateDto {
  @IsOptional()
  @IsIn([...PROMPT_CHANNELS])
  channel?: string;

  @IsOptional()
  @IsIn([...PROMPT_POST_KINDS])
  post_kind?: string;

  @IsOptional()
  @IsIn([...PROMPT_PURPOSES])
  purpose?: string;

  @IsOptional()
  @IsIn([...PROMPT_ROLES])
  prompt_role?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  template_text?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  required_context_keys?: string[];

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  change_note?: string;
}

export class CreateRenderTemplateDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  template_key!: string;

  @IsString()
  @MaxLength(200)
  display_name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsIn(['satori_v1', 'html_playwright_v1', 'code_registry_v1'])
  renderer?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  compatible_post_kinds?: string[];

  @IsObject()
  default_prompt_bundle!: Record<string, unknown>;
}

export class UpdateRenderTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  display_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  compatible_post_kinds?: string[];

  @IsOptional()
  @IsObject()
  default_prompt_bundle?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class PromptPreviewDto {
  @IsString()
  platform!: string;

  @IsOptional()
  @IsString()
  post_kind?: string;

  @IsOptional()
  @IsString()
  render_template_key?: string;

  @IsObject()
  context!: Record<string, string>;
}

export class GenerateMediaDto {
  @IsString()
  platform!: string;

  @IsOptional()
  @IsString()
  post_kind?: string;

  @IsOptional()
  @IsString()
  render_template_key?: string;

  @IsObject()
  context!: Record<string, string>;

  @IsIn(['image', 'video_script'])
  media_kind!: 'image' | 'video_script';
}

export class ListPromptGenerationsQueryDto {
  @IsOptional()
  @IsIn(['caption', 'image_prompt', 'video_script'])
  kind?: 'caption' | 'image_prompt' | 'video_script';

  @IsOptional()
  @IsString()
  render_template_key?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

export class UpdatePromptGenerationDto {
  @IsOptional()
  @IsString()
  woop_media_id?: string;

  @IsOptional()
  @IsIn(['text_only', 'media_linked', 'published'])
  status?: 'text_only' | 'media_linked' | 'published';
}

export class PreviewImagePromptDto {
  @IsOptional()
  @IsString()
  render_template_key?: string;

  @IsObject()
  context!: Record<string, string>;
}
