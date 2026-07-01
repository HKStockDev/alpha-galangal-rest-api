import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ClientEntitiesController } from './client-entities.controller';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [ClientsController, ClientEntitiesController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
