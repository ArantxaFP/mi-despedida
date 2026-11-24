import { IsString, Matches } from 'class-validator';

export class CanjearEnlaceAccesoLanzadorDto {

    @IsString({
        message: 'El token de acceso no es válido.'
    })
    @Matches(/^[a-f0-9]{64}$/, {
        message: 'El enlace de acceso no es válido.'
    })
    token: string;
}