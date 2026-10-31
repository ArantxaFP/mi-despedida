import { IsString, Matches } from 'class-validator';

export class DecidirInvitacionDto {

    // Token original de la invitación recibida por correo
    @IsString()
    @Matches(/^[a-f0-9]{64}$/, {
        message: 'El token de invitación no tiene un formato válido.'
    })
    token: string;

    // Credencial temporal emitida después de verificar el código enviado al correo del lanzador
    @IsString()
    @Matches(/^[a-f0-9]{64}$/, {
        message: 'La credencial de verificación no tiene un formato válido.'
    })
    credencialVerificacion: string;
}
