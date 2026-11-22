import {    IsString,    Matches,    MaxLength,    MinLength } from 'class-validator';

export class ActivarSuperadministradorDto {

    // Misma política de contraseña utilizada en el backoffice.
    @IsString()
    @MinLength(10)
    @MaxLength(128)
    @Matches(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9\s]).+$/
    )
    contrasena!: string;
}