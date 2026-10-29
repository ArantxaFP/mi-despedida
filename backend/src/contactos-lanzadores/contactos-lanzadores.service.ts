import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class ContactosLanzadoresService {

    constructor(
        private readonly supabaseService: SupabaseService
    ) { }

    async obtenerLanzadores(administradorId: string) {

        const supabase = this.supabaseService.obtenerCliente();

        const { data, error } = await supabase
            .from('asignaciones_lanzadores')
            .select(`
        id,
        estado,
        fecha_invitacion,
        fecha_caducidad,
        fecha_aceptacion,
        lanzadores (
          id,
          nombre,
          correo
        )
      `)
            .eq('administrador_id', administradorId)
            .order('fecha_invitacion', { ascending: false });

        if (error) {
            throw new InternalServerErrorException(
                'No se han podido consultar los lanzadores.'
            );
        }


        return data ?? [];
    }
}
