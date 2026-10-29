import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CrearInvitacionDto {

    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    nombre: string;

    @IsEmail()
    @IsNotEmpty()
    @MaxLength(254)
    correo: string;
}
