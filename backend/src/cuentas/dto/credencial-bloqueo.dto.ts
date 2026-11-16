import { IsString, Matches } from 'class-validator';

// Credencial temporal de una edición.
export class CredencialBloqueoDto {
    @IsString()
    @Matches(/^[a-f0-9]{64}$/, {
        message: 'La credencial de edición no es válida.'
    })
    token: string;
}
