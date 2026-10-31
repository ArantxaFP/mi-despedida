import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { InvitacionesLanzadoresService } from './invitaciones-lanzadores.service';
import { DecidirInvitacionDto } from './dto/decidir-invitacion.dto';
import { SolicitarCodigoDto } from './dto/solicitar-codigo.dto';
import { VerificarCodigoDto } from './dto/verificar-codigo.dto';

@Controller('invitaciones-lanzadores')
export class InvitacionesLanzadoresController {

    constructor(
        private readonly invitacionesService:
            InvitacionesLanzadoresService
    ) { }

    // --------------------------------------------------
    // 1. Verificar el control del correo del destinatario
    // sin exigir una cuenta propia de administrador
    // --------------------------------------------------

    @Post('solicitar-codigo')
    async solicitarCodigo(
        @Body() datos: SolicitarCodigoDto
    ) {
        return this.invitacionesService.solicitarCodigo(
            datos.token
        );
    }

    @Post('verificar-codigo')
    async verificarCodigo(
        @Body() datos: VerificarCodigoDto
    ) {
        return this.invitacionesService.verificarCodigo(
            datos.token,
            datos.codigo
        );
    }

    // --------------------------------------------------
    // 2. Consultar el estado público de una invitación
    // --------------------------------------------------

    @Get('consultar')
    async consultar(
        @Query('token') token?: string
    ) {
        return this.invitacionesService.consultarInvitacion(
            token ?? ''
        );
    }

    // --------------------------------------------------
    // 3. Aceptar una invitación
    // --------------------------------------------------

    @Post('aceptar')
    async aceptar(
        @Body() datos: DecidirInvitacionDto
    ) {
        return this.invitacionesService.decidirInvitacion(
            datos.token,
            datos.credencialVerificacion,
            'aceptada'
        );
    }

    // ------------------------------------------
    // 4. Rechazar una invitación
    // ------------------------------------------

    @Post('rechazar')
    async rechazar(
        @Body() datos: DecidirInvitacionDto
    ) {
        return this.invitacionesService.decidirInvitacion(
            datos.token,
            datos.credencialVerificacion,
            'rechazada'
        );
    }
}
