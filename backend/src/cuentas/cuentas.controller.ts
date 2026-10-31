import { Body, Controller, Headers, Patch, Post } from '@nestjs/common';
import { CuentasService } from './cuentas.service';
import { RegistrarCuentaDto } from './dto/registrar-cuenta.dto';
import { ActualizarDatosCuentaDto } from './dto/actualizar-datos-cuenta.dto';

@Controller('cuentas')
export class CuentasController {

    constructor(
        private readonly cuentasService: CuentasService
    ) { }

    // Registro de nuevos administradores.
    // No exige sesión porque el usuario aún no tiene cuenta porque está en el proceso de creación.
    @Post('registro')
    async registrar(
        @Body() datos: RegistrarCuentaDto
    ) {
        return this.cuentasService.registrar(datos);
    }

    // Sincronizar la cuenta después de verificar el correo.
    // También permite recuperar un registro incompleto cuando NestJS puede acreditar que estaba pendiente.
    @Post('sincronizar')
    async sincronizar(
        @Headers('authorization') autorizacion?: string
    ) {
        return this.cuentasService.sincronizar(autorizacion);
    }


    // Actualizar nombre y apellidos del administrador
    @Patch('perfil')
    async actualizarPerfil(
        @Headers('authorization') autorizacion: string | undefined,
        @Body() datos: ActualizarDatosCuentaDto
    ) {
        return this.cuentasService.actualizarDatosPersonales(
            autorizacion,
            datos.nombre,
            datos.apellidos
        );
    }


}
