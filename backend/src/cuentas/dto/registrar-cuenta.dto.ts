import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class RegistrarCuentaDto {

    @IsString()
    @MinLength(2)
    nombre: string;

    @IsEmail()
    correo: string;

    @IsString()
    @MinLength(10)
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9\s]).+$/)
    contrasena: string;
}
