import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Put, UnauthorizedException } from '@nestjs/common';
import { ContactosDestinatariosService } from './contactos-destinatarios.service';
import { SupabaseService } from '../supabase/supabase.service';
import { CuentasService } from '../cuentas/cuentas.service';
import { DatosDestinatarioDto } from './dto/datos-destinatario.dto';
import { GuardarMensajeDto } from './dto/guardar-mensaje.dto';

@Controller('contactos-destinatarios')
export class ContactosDestinatariosController {

    constructor(
        private readonly servicio: ContactosDestinatariosService,
        private readonly supabase: SupabaseService,
        private readonly cuentas: CuentasService
    ) { }

    private async identificarAdministrador(
        autorizacion?: string
    ): Promise<string> {

        if (!autorizacion || !/^Bearer\s+\S+$/i.test(autorizacion)) {
            throw new UnauthorizedException('Debes iniciar sesión.');
        }

        const token = autorizacion.split(/\s+/)[1];

        const { data, error } =
            await this.supabase.verificarUsuario(token);

        if (
            error ||
            !data.user ||
            !data.user.email ||
            !data.user.email_confirmed_at
        ) {
            throw new UnauthorizedException(
                'Tu sesión no es válida o tu correo no está verificado.'
            );
        }

        await this.cuentas.comprobarCuentaActiva(data.user.id);

        return data.user.id;
    }

    @Get()
    async listar(
        @Headers('authorization') autorizacion?: string
    ) {
        const id = await this.identificarAdministrador(autorizacion);
        return this.servicio.listar(id);
    }

    @Get(':id')
    async obtenerFicha(
        @Param('id') contactoId: string,
        @Headers('authorization') autorizacion?: string
    ) {
        const id = await this.identificarAdministrador(autorizacion);
        return this.servicio.obtenerFicha(id, contactoId);
    }

    @Post()
    async crear(
        @Body() datos: DatosDestinatarioDto,
        @Headers('authorization') autorizacion?: string
    ) {
        const id = await this.identificarAdministrador(autorizacion);
        return this.servicio.crear(id, datos);
    }

    @Patch(':id')
    async actualizar(
        @Param('id') contactoId: string,
        @Body() datos: DatosDestinatarioDto,
        @Headers('authorization') autorizacion?: string
    ) {
        const id = await this.identificarAdministrador(autorizacion);
        return this.servicio.actualizar(id, contactoId, datos);
    }

    @Delete(':id')
    @HttpCode(204)
    async eliminar(
        @Param('id') contactoId: string,
        @Headers('authorization') autorizacion?: string
    ): Promise<void> {
        const id = await this.identificarAdministrador(autorizacion);
        await this.servicio.eliminar(id, contactoId);
    }

    @Put(':id/mensaje')
    async guardarMensaje(
        @Param('id') contactoId: string,
        @Body() datos: GuardarMensajeDto,
        @Headers('authorization') autorizacion?: string
    ) {
        const id = await this.identificarAdministrador(autorizacion);
        return this.servicio.guardarMensaje(
            id,
            contactoId,
            datos.contenido
        );
    }

    @Delete(':id/mensaje')
    @HttpCode(204)
    async eliminarMensaje(
        @Param('id') contactoId: string,
        @Headers('authorization') autorizacion?: string
    ): Promise<void> {
        const id = await this.identificarAdministrador(autorizacion);
        await this.servicio.eliminarMensaje(id, contactoId);
    }
}
