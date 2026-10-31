import { IsString, Matches } from 'class-validator';

export class SolicitarCodigoDto {
    // Token de la invitación recibida por correo
    @IsString()
    @Matches(/^[a-f0-9]{64}$/, {
        message: 'El token de invitación no tiene un formato válido.'
    })
    token: string;
}
