import { Body, Controller, Get, Headers, Post, UnauthorizedException, Param, Patch, ValidationPipe, UseGuards } from '@nestjs/common';
import { ContactosLanzadoresService } from './contactos-lanzadores.service';
import { SupabaseService } from '../supabase/supabase.service';
import { CuentasService } from '../cuentas/cuentas.service';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { CrearInvitacionDto } from './dto/crear-invitacion.dto';
import { SolicitarAccesoLanzadorDto } from './dto/solicitar-acceso-lanzador.dto';
import { VerificarCodigoAccesoLanzadorDto } from './dto/verificar-codigo-acceso-lanzador.dto';
import { SeleccionarAdministradorLanzadorDto } from './dto/seleccionar-administrador-lanzador.dto';
import { CanjearEnlaceAccesoLanzadorDto } from './dto/canjear-enlace-acceso-lanzador.dto';

@Controller('contactos-lanzadores')
export class ContactosLanzadoresController {

    constructor(
        private readonly contactosLanzadoresService:
            ContactosLanzadoresService,
        private readonly supabaseService: SupabaseService,
        private readonly cuentasService: CuentasService
    ) { }

    private async verificarSesion(
        autorizacion?: string
    ) {
        if (
            !autorizacion ||
            !/^Bearer\s+\S+$/i.test(autorizacion)
        ) {
            throw new UnauthorizedException(
                'Debes iniciar sesión.'
            );
        }

        const token = autorizacion.split(/\s+/)[1];

        const { data, error } =
            await this.supabaseService.verificarUsuario(token);

        if (error || !data.user) {
            throw new UnauthorizedException(
                'La sesión no es válida o ha caducado.'
            );
        }

        // Todas las operaciones privadas requieren que el correo del administrador esté verificado
        if (!data.user.email_confirmed_at) {
            throw new UnauthorizedException(
                'Debes verificar tu correo electrónico.'
            );
        }

        return data.user;
    }

    @Get()
    async obtenerLanzadores(
        @Headers('authorization') autorizacion?: string
    ) {
        const usuario = await this.verificarSesion(
            autorizacion
        );

        // El administrador debe tener una cuenta activa
        await this.cuentasService.comprobarCuentaActiva(
            usuario.id
        );

        return this.contactosLanzadoresService.obtenerLanzadores(
            usuario.id
        );
    }


    @Post('invitaciones')
    async crearInvitacion(
        @Body() datos: CrearInvitacionDto,
        @Headers('authorization') autorizacion?: string,
        @Headers('origin') origen?: string
    ) {
        const usuario = await this.verificarSesion(
            autorizacion
        );

        if (!usuario.email || !usuario.email_confirmed_at) {
            throw new UnauthorizedException(
                'La cuenta debe tener un correo verificado.'
            );
        }

        // El administrador debe tener una cuenta activa
        await this.cuentasService.comprobarCuentaActiva(
            usuario.id
        );

        return this.contactosLanzadoresService.crearYEnviarInvitacion(
            usuario.id,
            usuario.email,
            datos,
            origen
        );
    }

    // Retirar una invitación pendiente.
    @Patch(':id/retirar')
    async retirarInvitacion(
        @Param('id') asignacionId: string,
        @Headers('authorization') autorizacion?: string
    ) {
        const usuario =
            await this.verificarSesion(autorizacion);

        await this.cuentasService.comprobarCuentaActiva(
            usuario.id
        );

        return this.contactosLanzadoresService.retirarInvitacion(
            usuario.id,
            asignacionId
        );
    }

    // Revocar una autorización aceptada
    @Patch(':id/revocar')
    async revocarAutorizacion(
        @Param('id') asignacionId: string,
        @Headers('authorization') autorizacion?: string
    ) {
        const usuario =
            await this.verificarSesion(autorizacion);

        await this.cuentasService.comprobarCuentaActiva(
            usuario.id
        );

        return this.contactosLanzadoresService.revocarAutorizacion(
            usuario.id,
            asignacionId
        );
    }

    // Reenviar invitación pendiente o caducada
    @Post(':id/reenviar')
    async reenviarInvitacion(
        @Param('id') asignacionId: string,
        @Headers('authorization') autorizacion?: string,
        @Headers('origin') origen?: string
    ) {
        const usuario = await this.verificarSesion(
            autorizacion
        );

        if (!usuario.email || !usuario.email_confirmed_at) {
            throw new UnauthorizedException(
                'La cuenta debe tener un correo verificado.'
            );
        }

        await this.cuentasService.comprobarCuentaActiva(
            usuario.id
        );

        return this.contactosLanzadoresService.reenviarInvitacion(
            usuario.id,
            usuario.email,
            asignacionId,
            origen
        );
    }

    // Solicitar acceso como lanzador mediante correo electrónico.
    // La respuesta es genérica para no revelar si el correo existe o no en el sistema por privacidad de datos.
    @UseGuards(ThrottlerGuard)
    @Throttle({ default: { limit: 5, ttl: 60_000 } })
    @Post('acceso/solicitar')
    async solicitarAccesoComoLanzador(
        @Body(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true
        }))
        datos: SolicitarAccesoLanzadorDto
    ) {
        return this.contactosLanzadoresService
            .solicitarAccesoComoLanzador(
                datos.correo
            );
    }


    // Verificar el código de 8 dígitos enviado al correo del lanzador.
    // Este procedimiento se utiliza tanto si tiene una autorización como si tiene varias.
    // Tras verificar el correo se obtiene una credencial temporal de selección.
    // La verificación no crea una sesión ni autoriza activaciones.
    @UseGuards(ThrottlerGuard)
    @Post('acceso/verificar-codigo')
    async verificarCodigoAccesoComoLanzador(
        @Body(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true
        }))
        datos: VerificarCodigoAccesoLanzadorDto
    ) {
        return this.contactosLanzadoresService
            .verificarCodigoAccesoComoLanzador(
                datos.correo,
                datos.codigo
            );
    }


    // Seleccionar el administrador para el que se quiere actuar como contacto lanzador.
    // Iniciar esta sesión no implica solicitar ni confirmar una despedida.
    // La selección será automática si solo dispone de una autorización vigente.
    // Si dispone de varias autorizaciones, deberá elegir un administrador.
    // La selección crea una sesión temporal sin enviar nuevos correos.    
    @UseGuards(ThrottlerGuard)
    @Post('acceso/seleccionar-administrador')
    async seleccionarAdministradorAccesoLanzador(
        @Body(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true
        }))
        datos: SeleccionarAdministradorLanzadorDto
    ) {
        return this.contactosLanzadoresService
            .seleccionarAdministradorAccesoLanzador(
                datos.tokenSeleccion,
                datos.asignacionId
            );
    }

    // Consultar la sesión temporal del lanzador
    @UseGuards(ThrottlerGuard)
    @Get('acceso/sesion')
    async obtenerSesionLanzador(
        @Headers('x-lanzador-session')
        tokenSesion?: string
    ) {
        return this.contactosLanzadoresService.obtenerSesionLanzador(
            tokenSesion
        );
    }

    // Consultar el estado de activación del administrador.
    // Requiere una sesión temporal válida de lanzador.
    // No devuelve destinatarios ni mensajes privados por privacidad de datos.
    @UseGuards(ThrottlerGuard)
    @Get('acceso/estado-activacion')
    async consultarEstadoActivacionLanzador(
        @Headers('x-lanzador-session')
        tokenSesion?: string
    ) {
        return this.contactosLanzadoresService
            .consultarEstadoActivacionLanzador(tokenSesion);
    }


    // Cerrar la sesión temporal del lanzador
    @UseGuards(ThrottlerGuard)
    @Post('acceso/cerrar-sesion')
    async cerrarSesionLanzador(
        @Headers('x-lanzador-session')
        tokenSesion?: string
    ) {
        return this.contactosLanzadoresService.cerrarSesionLanzador(
            tokenSesion
        );
    }





    // OJO: antiguo endpoint de acceso mediante enlace temporal de un solo uso.
    // Se conserva temporalmente para rechazar enlaces anteriores.
    // El acceso como lanzador ahora se realiza mediante código de ocho dígitos.
    // No afecta a los enlaces de aceptación de invitaciones iniciales.
    // Recordar quitarlo dentro de unos días.
    @UseGuards(ThrottlerGuard)
    @Post('acceso/canjear-enlace')
    async canjearEnlaceAccesoLanzador(
        @Body(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true
        }))
        datos: CanjearEnlaceAccesoLanzadorDto
    ) {
        return this.contactosLanzadoresService
            .canjearEnlaceAccesoLanzador(datos.token);
    }

}
