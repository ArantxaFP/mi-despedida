import { Body, Controller, Get, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ContactosLanzadoresService } from './contactos-lanzadores.service';
import { SupabaseService } from '../supabase/supabase.service';
import { CrearInvitacionDto } from './dto/crear-invitacion.dto';

@Controller('contactos-lanzadores')
export class ContactosLanzadoresController {

    constructor(
        private readonly contactosLanzadoresService:
            ContactosLanzadoresService,
        private readonly supabaseService: SupabaseService
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

        return data.user;
    }

    @Get()
    async obtenerLanzadores(
        @Headers('authorization') autorizacion?: string
    ) {
        const usuario = await this.verificarSesion(
            autorizacion
        );

        return this.contactosLanzadoresService.obtenerLanzadores(
            usuario.id
        );
    }

    @Post('invitaciones')
    async crearInvitacion(
        @Body() datos: CrearInvitacionDto,
        @Headers('authorization') autorizacion?: string
    ) {
        const usuario = await this.verificarSesion(
            autorizacion
        );

        if (!usuario.email || !usuario.email_confirmed_at) {
            throw new UnauthorizedException(
                'La cuenta debe tener un correo verificado.'
            );
        }

        return this.contactosLanzadoresService.crearYEnviarInvitacion(
            usuario.id,
            usuario.email,
            datos
        );
    }
}
