import { Body, Controller, Get, Headers, Post, UnauthorizedException, Param, Patch, ValidationPipe } from '@nestjs/common';
import { ContactosLanzadoresService } from './contactos-lanzadores.service';
import { SupabaseService } from '../supabase/supabase.service';
import { CuentasService } from '../cuentas/cuentas.service';

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
    @Post('acceso/solicitar')
    async solicitarAccesoComoLanzador(
        @Body(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true
        }))
        datos: SolicitarAccesoLanzadorDto,
        @Headers('origin') origen?: string
    ) {
        return this.contactosLanzadoresService
            .solicitarAccesoComoLanzador(
                datos.correo,
                origen
            );
    }

    // Verificar el código de 8 dígitos enviado al correo del lanzador.
    // Este procedimiento se utiliza cuando tiene varias autorizaciones.
    // Tras verificar el correo podrá seleccionar un administrador.
    // La verificación no crea una sesión ni autoriza activaciones.
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

    // Seleccionar el administrador con el que se quiere actuar cuando el lanzador dispone de varias autorizaciones vigentes
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
    @Get('acceso/sesion')
    async obtenerSesionLanzador(
        @Headers('x-lanzador-session')
        tokenSesion?: string
    ) {
        return this.contactosLanzadoresService.obtenerSesionLanzador(
            tokenSesion
        );
    }

    // Cerrar la sesión temporal del lanzador
    @Post('acceso/cerrar-sesion')
    async cerrarSesionLanzador(
        @Headers('x-lanzador-session')
        tokenSesion?: string
    ) {
        return this.contactosLanzadoresService.cerrarSesionLanzador(
            tokenSesion
        );
    }

    // Canjear un enlace temporal de un solo uso.
    // Abrir el enlace no inicia ni confirma ningún envío.
    // Validar el formato del token antes de enviarlo al servicio.
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
