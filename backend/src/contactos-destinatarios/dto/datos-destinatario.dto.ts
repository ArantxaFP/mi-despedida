import { IsEmail, IsNotEmpty, IsString, MaxLength, Matches } from 'class-validator';

export class DatosDestinatarioDto {

    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    @Matches(/\S/)
    nombre!: string;

    @IsEmail()
    @MaxLength(254)
    correo!: string;
}
