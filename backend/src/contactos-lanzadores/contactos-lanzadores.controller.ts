import { Controller, Get, Headers, UnauthorizedException } from '@nestjs/common';
import { ContactosLanzadoresService } from './contactos-lanzadores.service';
import { SupabaseService } from '../supabase/supabase.service';

@Controller('contactos-lanzadores')
export class ContactosLanzadoresController {

    constructor(
        private readonly contactosLanzadoresService: ContactosLanzadoresService,
        private readonly supabaseService: SupabaseService
    ) { }

    @Get()
    async obtenerLanzadores(
        @Headers('authorization') autorizacion?: string
    ) {

        if (!autorizacion?.startsWith('Bearer ')) {
            throw new UnauthorizedException(
                'Debes iniciar sesión para consultar tus lanzadores.'
            );
        }

        const token = autorizacion.substring(7);

        const { data, error } =
            await this.supabaseService.verificarUsuario(token);

        if (error || !data.user) {
            throw new UnauthorizedException(
                'La sesión no es válida o ha caducado.'
            );
        }

        return this.contactosLanzadoresService.obtenerLanzadores(
            data.user.id
        );
    }
}
