import { IsString, Matches } from 'class-validator';

export class VerificarCodigoDto {
    // Token de la invitación recibida por correo
    @IsString()
    @Matches(/^[a-f0-9]{64}$/, {
        message: 'El token de invitación no tiene un formato válido.'
    })
    token: string;

    // Código de ocho dígitos enviado mediante Brevo
    @IsString()
    @Matches(/^\d{8}$/, {
        message: 'El código de verificación debe contener ocho dígitos.'
    })
    codigo: string;
}
