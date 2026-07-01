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
import {
  CreateOrganizationClientDto,
  UpdateOrganizationClientDto,
} from './dto';

@Controller('organizations/:organizationId/clients')
@UseGuards(SupabaseAuthGuard, OrgMemberGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  list(@Param('organizationId') organizationId: string) {
    return this.clientsService.listClients(organizationId);
  }

  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateOrganizationClientDto,
  ) {
    return this.clientsService.createClient(organizationId, dto);
  }

  @Get(':clientId')
  getOne(
    @Param('organizationId') organizationId: string,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsService.getClient(organizationId, clientId);
  }

  @Patch(':clientId')
  update(
    @Param('organizationId') organizationId: string,
    @Param('clientId') clientId: string,
    @Body() dto: UpdateOrganizationClientDto,
  ) {
    return this.clientsService.updateClient(organizationId, clientId, dto);
  }

  @Delete(':clientId')
  remove(
    @Param('organizationId') organizationId: string,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsService.deleteClient(organizationId, clientId);
  }
}
