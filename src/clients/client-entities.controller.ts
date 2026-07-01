import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { OrgMemberGuard } from '../organizations/guards/org-member.guard';
import { ClientsService } from './clients.service';
import { CreateClientEntityDto, UpdateClientEntityDto } from './dto';

@Controller('organizations/:organizationId/clients/:clientId/entities')
@UseGuards(SupabaseAuthGuard, OrgMemberGuard)
export class ClientEntitiesController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  list(
    @Param('organizationId') organizationId: string,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsService.listEntities(organizationId, clientId);
  }

  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @Param('clientId') clientId: string,
    @Body() dto: CreateClientEntityDto,
  ) {
    return this.clientsService.createEntity(organizationId, clientId, dto);
  }

  @Get(':entityId')
  getOne(
    @Param('organizationId') organizationId: string,
    @Param('clientId') clientId: string,
    @Param('entityId') entityId: string,
  ) {
    return this.clientsService.getEntity(organizationId, clientId, entityId);
  }

  @Patch(':entityId')
  update(
    @Param('organizationId') organizationId: string,
    @Param('clientId') clientId: string,
    @Param('entityId') entityId: string,
    @Body() dto: UpdateClientEntityDto,
  ) {
    return this.clientsService.updateEntity(
      organizationId,
      clientId,
      entityId,
      dto,
    );
  }

  @Delete(':entityId')
  remove(
    @Param('organizationId') organizationId: string,
    @Param('clientId') clientId: string,
    @Param('entityId') entityId: string,
  ) {
    return this.clientsService.deleteEntity(organizationId, clientId, entityId);
  }
}
