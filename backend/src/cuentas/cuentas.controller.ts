import { Body, Controller, Headers, Patch, Post, Get, Param, ParseUUIDPipe, ValidationPipe, Query, DefaultValuePipe, ParseIntPipe, Delete } from '@nestjs/common';
import { CuentasService } from './cuentas.service';

import { RegistrarCuentaDto } from './dto/registrar-cuenta.dto';
import { EditarCuentaSuperadminDto } from './dto/editar-cuenta-superadmin.dto';
import { CredencialBloqueoDto } from './dto/credencial-bloqueo.dto';
import { ActualizarDatosPerfilBloqueoDto } from './dto/actualizar-datos-perfil-bloqueo.dto';
import { SuspenderCuentaDto } from './dto/suspender-cuenta.dto';
import { CrearSuperadministradorDto } from './dto/crear-superadministrador.dto';
import { ActivarSuperadministradorDto } from './dto/activar-superadministrador.dto';

@Controller('cuentas')
export class CuentasController {

    constructor(
        private readonly cuentasService: CuentasService
    ) { }

    // Registro de nuevos administradores.
    // No exige sesión porque el usuario aún no tiene cuenta porque está en el proceso de creación.
    @Post('registro')
    async registrar(
        @Body() datos: RegistrarCuentaDto,
        @Headers('origin') origen?: string
    ) {
        return this.cuentasService.registrar(datos, origen);
    }

    // Sincronizar la cuenta después de verificar el correo.
    // También permite recuperar un registro incompleto cuando NestJS puede acreditar que estaba pendiente.
    @Post('sincronizar')
    async sincronizar(
        @Headers('authorization') autorizacion?: string
    ) {
        return this.cuentasService.sincronizar(autorizacion);
    }

    // Consultar el rol y el estado de la cuenta autenticada.
    // Se utilizará para dirigir al usuario a su panel correspondiente.
    @Get('mi-acceso')
    async obtenerMiAcceso(
        @Headers('authorization') autorizacion?: string
    ) {
        return this.cuentasService.obtenerMiAcceso(autorizacion);
    }


    // Listado exclusivo de usuarios superadministradores
    @Get('superadmin/superadministradores')
    async listarSuperadministradores(
        @Headers('authorization')
        autorizacion?: string
    ) {
        return this.cuentasService.listarSuperadministradores(
            autorizacion
        );
    }



    // Reenviar invitación pendiente de superadministrador
    @Post('superadmin/superadministradores/:id/reenviar-invitacion')
    async reenviarInvitacionSuperadministrador(
        @Headers('authorization')
        autorizacion: string | undefined,

        @Param('id', new ParseUUIDPipe({ version: 'all' }))
        cuentaId: string
    ) {
        return this.cuentasService.reenviarInvitacionSuperadministrador(
            autorizacion,
            cuentaId
        );
    }


    // Eliminar un superadministrador con protección propia y auditoría
    @Delete('superadmin/superadministradores/:id')
    async eliminarSuperadministrador(
        @Headers('authorization')
        autorizacion: string | undefined,

        @Param('id', new ParseUUIDPipe({ version: 'all' }))
        cuentaId: string
    ) {
        return this.cuentasService.eliminarSuperadministrador(
            autorizacion,
            cuentaId
        );
    }


    // Crear e invitar un superadministrador
    @Post('superadmin/superadministradores')
    async crearSuperadministrador(
        @Headers('authorization')
        autorizacion: string | undefined,

        @Body(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true
        }))
        datos: CrearSuperadministradorDto
    ) {
        return this.cuentasService.crearSuperadministrador(
            autorizacion,
            datos
        );
    }

    // Activar una invitación después de verificar el correo.
    // La identidad del invitado se obtiene de su sesión Supabase.
    @Post('superadmin/activar-invitacion')
    async activarSuperadministrador(
        @Headers('authorization')
        autorizacion: string | undefined,

        @Body(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true
        }))
        datos: ActivarSuperadministradorDto
    ) {
        return this.cuentasService.activarSuperadministrador(
            autorizacion,
            datos
        );
    }

    // Listado de cuentas exclusivo del superadministrador
    @Get('superadmin/listado')
    async listarCuentasSuperadministrador(
        @Headers('authorization') autorizacion?: string
    ) {
        return this.cuentasService.listarCuentasSuperadministrador(
            autorizacion
        );
    }


    // Consultar la auditoría de una cuenta concreta
    @Get('superadmin/cuentas/:id/auditoria')
    async listarAuditoriaCuentaSuperadministrador(
        @Param('id', new ParseUUIDPipe({ version: 'all' }))
        cuentaId: string,

        @Headers('authorization')
        autorizacion: string | undefined,

        @Query(
            'pagina',
            new DefaultValuePipe(1),
            ParseIntPipe
        )
        pagina: number
    ) {
        return this.cuentasService.listarAuditoriaCuentaSuperadministrador(
            autorizacion,
            cuentaId,
            pagina
        );
    }

    // Solo permite consultar los cambios propuestos.
    // No guarda modificaciones en la base de datos.
    @Post('superadmin/cuentas/:id/previsualizar-edicion')
    async previsualizarEdicionSuperadministrador(
        @Param('id', new ParseUUIDPipe({ version: 'all' }))
        cuentaId: string,

        @Body(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true
        }))
        datos: EditarCuentaSuperadminDto,

        @Headers('authorization')
        autorizacion?: string
    ) {
        return this.cuentasService
            .previsualizarEdicionCuentaSuperadministrador(
                autorizacion,
                cuentaId,
                datos
            );
    }


    @Post('superadmin/cuentas/:id/bloqueo')
    async adquirirBloqueoEdicionSuperadministrador(
        @Param('id', new ParseUUIDPipe({ version: 'all' }))
        cuentaId: string,
        @Headers('authorization') autorizacion?: string
    ) {
        return this.cuentasService.adquirirBloqueoEdicionSuperadministrador(
            autorizacion,
            cuentaId
        );
    }

    @Post('superadmin/cuentas/:id/bloqueo/renovar')
    async renovarBloqueoEdicionSuperadministrador(
        @Param('id', new ParseUUIDPipe({ version: 'all' }))
        cuentaId: string,
        @Body(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true
        }))
        datos: CredencialBloqueoDto,
        @Headers('authorization') autorizacion?: string
    ) {
        return this.cuentasService.renovarBloqueoEdicionSuperadministrador(
            autorizacion,
            cuentaId,
            datos.token
        );
    }

    @Post('superadmin/cuentas/:id/bloqueo/liberar')
    async liberarBloqueoEdicionSuperadministrador(
        @Param('id', new ParseUUIDPipe({ version: 'all' }))
        cuentaId: string,
        @Body(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true
        }))
        datos: CredencialBloqueoDto,
        @Headers('authorization') autorizacion?: string
    ) {
        return this.cuentasService.liberarBloqueoEdicionSuperadministrador(
            autorizacion,
            cuentaId,
            datos.token
        );
    }

    @Patch('superadmin/cuentas/:id/datos-con-bloqueo')
    async actualizarDatosCuentaSuperadministrador(
        @Param('id', new ParseUUIDPipe({ version: 'all' }))
        cuentaId: string,

        @Headers('authorization')
        autorizacion: string | undefined,

        @Body(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true
        }))
        datos: ActualizarDatosPerfilBloqueoDto
    ) {
        return this.cuentasService.actualizarDatosCuentaSuperadministrador(
            autorizacion,
            cuentaId,
            datos
        );
    }


    // Suspender una cuenta
    @Patch('superadmin/cuentas/:id/suspender')
    async suspenderCuentaSuperadministrador(
        @Param('id', new ParseUUIDPipe({ version: 'all' }))
        cuentaId: string,

        @Headers('authorization')
        autorizacion: string | undefined,

        @Body(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true
        }))
        datos: SuspenderCuentaDto
    ) {
        return this.cuentasService.suspenderCuentaSuperadministrador(
            autorizacion,
            cuentaId,
            datos
        );
    }


    // Reactivar una cuenta suspendida desde el panel de superadministración
    @Patch('superadmin/cuentas/:id/reactivar')
    async reactivarCuentaSuperadministrador(
        @Param('id', new ParseUUIDPipe({ version: 'all' }))
        cuentaId: string,

        @Headers('authorization')
        autorizacion?: string
    ) {
        return this.cuentasService.reactivarCuentaSuperadministrador(
            autorizacion,
            cuentaId
        );
    }

    // Dar de baja una cuenta de administrador desde superadministración
    @Patch('superadmin/cuentas/:id/baja')
    async darDeBajaCuentaSuperadministrador(
        @Param('id', new ParseUUIDPipe({ version: 'all' }))
        cuentaId: string,

        @Headers('authorization')
        autorizacion?: string
    ) {
        return this.cuentasService.darDeBajaCuentaSuperadministrador(
            autorizacion,
            cuentaId
        );
    }

    // Recuperar una cuenta dada de baja desde superadministración
    @Patch('superadmin/cuentas/:id/recuperar')
    async recuperarCuentaSuperadministrador(
        @Param('id', new ParseUUIDPipe({ version: 'all' }))
        cuentaId: string,

        @Headers('authorization')
        autorizacion?: string
    ) {
        return this.cuentasService.recuperarCuentaSuperadministrador(
            autorizacion,
            cuentaId
        );
    }


    // Solicitar un bloqueo prioritario para editar el perfil
    @Post('edicion/:id/bloqueo')
    async adquirirBloqueoEdicionPerfil(
        @Param('id', new ParseUUIDPipe({ version: 'all' }))
        cuentaId: string,

        @Headers('authorization')
        autorizacion?: string
    ) {
        return this.cuentasService.adquirirBloqueoEdicionPerfil(
            autorizacion,
            cuentaId
        );
    }


    // Renovar el bloqueo de edición del administrador titular
    @Post('edicion/:id/bloqueo/renovar')
    async renovarBloqueoEdicionPerfil(
        @Param('id', new ParseUUIDPipe({ version: 'all' }))
        cuentaId: string,

        @Body(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true
        }))
        datos: CredencialBloqueoDto,

        @Headers('authorization')
        autorizacion?: string
    ) {
        return this.cuentasService.renovarBloqueoEdicionPerfil(
            autorizacion,
            cuentaId,
            datos.token
        );
    }


    // Liberar el bloqueo cuando se cancela la edición
    @Post('edicion/:id/bloqueo/liberar')
    async liberarBloqueoEdicionPerfil(
        @Param('id', new ParseUUIDPipe({ version: 'all' }))
        cuentaId: string,

        @Body(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true
        }))
        datos: CredencialBloqueoDto,

        @Headers('authorization')
        autorizacion?: string
    ) {
        return this.cuentasService.liberarBloqueoEdicionPerfil(
            autorizacion,
            cuentaId,
            datos.token
        );
    }

    @Get('perfil')
    async obtenerDatosPerfil(
        @Headers('authorization') autorizacion?: string
    ) {
        return this.cuentasService.obtenerDatosPerfil(autorizacion);
    }


    // Baja voluntaria solicitada desde Mi perfil.
    // El backend identifica al titular mediante su sesión, sin aceptar el identificador de otra cuenta desde el frontend.
    @Patch('perfil/baja')
    async darDeBajaMiCuenta(
        @Headers('authorization')
        autorizacion?: string
    ) {
        return this.cuentasService.darDeBajaMiCuenta(
            autorizacion
        );
    }


    // Actualizar nombre y apellidos del administrador
    @Patch('perfil/datos-con-bloqueo')
    async actualizarDatosPerfilBloqueo(
        @Headers('authorization') autorizacion: string | undefined,
        @Body(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true
        }))
        datos: ActualizarDatosPerfilBloqueoDto
    ) {
        return this.cuentasService.actualizarDatosPerfilConBloqueo(
            autorizacion,
            datos
        );
    }


}
