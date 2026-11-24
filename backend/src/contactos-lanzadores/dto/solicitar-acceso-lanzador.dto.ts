import { IsEmail, Matches, MaxLength } from 'class-validator';

export class SolicitarAccesoLanzadorDto {
    @IsEmail(
        {},
        {
            message: 'Introduce una dirección de correo válida.'
        }
    )
    @MaxLength(320, {
        message: 'Este correo electrónico no es válido.'
    })
    @Matches(/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/, {
        message: 'Introduce una dirección de correo válida.'
    })
    correo: string;
}